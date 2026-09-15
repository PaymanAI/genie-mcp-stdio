import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { FakeAuthServer } from "./fakeAuthServer.js";

export interface SeenRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * A stand-in for the remote Genie MCP: Streamable HTTP, one `ask_genie` tool, and the
 * same admission rule — exactly one credential, or 401 with a Bearer challenge.
 */
export class FakeGenie {
  readonly seen: SeenRequest[] = [];
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>();
  private http: HttpServer | undefined;
  private markStandaloneStream: () => void = () => {};
  private readonly standaloneStreamOpened = new Promise<void>((resolve) => {
    this.markStandaloneStream = resolve;
  });

  constructor(
    private readonly accepts: (headers: IncomingMessage["headers"]) => boolean,
    private readonly elicitBeforeAnswer = false,
    private readonly authServer: FakeAuthServer | undefined = undefined,
  ) {}

  async start(): Promise<URL> {
    this.http = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => this.http!.listen(0, "127.0.0.1", resolve));
    const address = this.http.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    this.authServer?.bind(`http://127.0.0.1:${address.port}`);
    return new URL(`http://127.0.0.1:${address.port}/mcp`);
  }

  async stop(): Promise<void> {
    for (const transport of this.sessions.values()) await transport.close();
    await new Promise<void>((resolve, reject) =>
      this.http === undefined ? resolve() : this.http.close((e) => (e ? reject(e) : resolve())),
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.authServer !== undefined && (await this.authServer.handle(req, res))) return;
    this.seen.push({ headers: req.headers });
    const authorizations = headerCount(req, "authorization");
    const keys = headerCount(req, "x-paygent-mcp-access-key");
    if (authorizations + keys !== 1 || !this.accepts(req.headers)) {
      const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
      res.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="yuki:ask"`,
      });
      res.end();
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    let transport = typeof sessionId === "string" ? this.sessions.get(sessionId) : undefined;
    if (transport === undefined) {
      transport = await this.newSession();
    }
    if (req.method === "GET") this.markStandaloneStream();
    await transport.handleRequest(req, res);
  }

  private async newSession(): Promise<StreamableHTTPServerTransport> {
    const server = new Server({ name: "fake-genie", version: "0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "ask_genie",
          description: "Ask Genie",
          inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
        },
      ],
    }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const message = String((request.params.arguments as { message?: unknown } | undefined)?.message ?? "");
      let suffix = "";
      if (this.elicitBeforeAnswer) {
        // Genie answers POSTs with plain JSON, so its elicitations travel on the standalone
        // GET stream; wait for the bridge to have opened it, as a real host's pacing allows.
        await this.standaloneStreamOpened;
        const result = await server.elicitInput({
          message: "Which account?",
          requestedSchema: { type: "object", properties: { account: { type: "string" } }, required: ["account"] },
        });
        suffix = ` [${result.action}:${String((result.content as { account?: unknown } | undefined)?.account ?? "")}]`;
      }
      return { content: [{ type: "text", text: `genie heard: ${message}${suffix}` }] };
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        this.sessions.set(id, transport);
      },
    });
    await server.connect(transport);
    return transport;
  }
}

function headerCount(req: IncomingMessage, name: string): number {
  const value = req.headers[name];
  if (value === undefined) return 0;
  return Array.isArray(value) ? value.length : value.split(",").length;
}
