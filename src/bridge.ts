import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ElicitRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  McpError,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { credentialHeaders, type BridgeConfig } from "./config.js";

export const BRIDGE_NAME = "genie-mcp-stdio";
export const BRIDGE_VERSION = "0.1.0";

export type Log = (message: string) => void;

/**
 * One stdio MCP server facing the host, one Streamable HTTP client facing Genie.
 * Tools are forwarded verbatim; Genie's elicitation requests are relayed to the host
 * when the host declared that capability. The remote session opens on first use so a
 * host sees a healthy server at startup and gets a precise error on the first call.
 */
export class GenieBridge {
  private readonly server: Server;
  private remote: Promise<Client> | undefined;

  constructor(
    private readonly config: BridgeConfig,
    private readonly log: Log,
  ) {
    this.server = new Server(
      { name: BRIDGE_NAME, version: BRIDGE_VERSION },
      { capabilities: { tools: { listChanged: true } } },
    );
    this.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      const client = await this.connected();
      return client.request(request, ListToolsResultSchema, { signal: extra.signal });
    });
    this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const client = await this.connected();
      return client.request(request, CallToolResultSchema, { signal: extra.signal });
    });
    this.server.onclose = () => {
      void this.closeRemote();
    };
  }

  async serve(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
  }

  async close(): Promise<void> {
    await this.closeRemote();
    await this.server.close();
  }

  private connected(): Promise<Client> {
    if (this.remote === undefined) {
      this.remote = this.openRemote().catch((error: unknown) => {
        this.remote = undefined;
        throw toMcpError(error);
      });
    }
    return this.remote;
  }

  private async openRemote(): Promise<Client> {
    const hostElicits = this.server.getClientCapabilities()?.elicitation !== undefined;
    const client = new Client(
      { name: BRIDGE_NAME, version: BRIDGE_VERSION },
      { capabilities: hostElicits ? { elicitation: {} } : {} },
    );
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      await this.server.sendToolListChanged();
    });
    if (hostElicits) {
      client.setRequestHandler(ElicitRequestSchema, (request, extra) =>
        this.server.elicitInput(request.params, { signal: extra.signal }),
      );
    }
    client.onclose = () => {
      this.log("Genie session closed; the next call reconnects.");
      this.remote = undefined;
    };
    client.onerror = (error) => {
      this.log(`Genie session error: ${error.message}`);
    };
    const transport = new StreamableHTTPClientTransport(this.config.url, {
      requestInit: { headers: credentialHeaders(this.config.credential) },
    });
    await client.connect(transport);
    this.log(`Connected to Genie at ${this.config.url.href}`);
    return client;
  }

  private async closeRemote(): Promise<void> {
    const pending = this.remote;
    this.remote = undefined;
    if (pending === undefined) return;
    try {
      await (await pending).close();
    } catch {
      // Already failed or closed; nothing to release.
    }
  }
}

/** Host-facing error text names the failure without echoing any credential. */
function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return hostError(error.code, error.message, error.data);
  }
  const status = error instanceof StreamableHTTPError ? error.code : undefined;
  if (status === 401) {
    return hostError(
      ErrorCode.InvalidRequest,
      "Genie rejected the bridge credential (HTTP 401). Check GENIE_ACCESS_TOKEN or GENIE_INTEGRATION_KEY.",
    );
  }
  if (status === 403) {
    return hostError(ErrorCode.InvalidRequest, "Genie refused this credential for this resource (HTTP 403).");
  }
  const message = error instanceof Error ? error.message : String(error);
  return hostError(ErrorCode.InternalError, `Could not reach Genie: ${message}`);
}

/** The host's SDK adds its own "MCP error <code>:" prefix; send the bare text so it appears once. */
function hostError(code: number, message: string, data?: unknown): McpError {
  const error = new McpError(code, message, data);
  error.message = message.replace(/^(MCP error -?\d+: )+/, "");
  return error;
}
