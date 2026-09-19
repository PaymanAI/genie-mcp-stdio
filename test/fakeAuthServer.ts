import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The slice of Genie's authorization server the bridge relies on: RFC 9728 resource
 * metadata, RFC 8414 discovery, auto-approving PKCE authorization, code and refresh
 * grants with rotation, and RFC 7009 revocation. Access tokens stay valid until
 * `expireAccessTokens()`, which is how the tests provoke a refresh.
 */
export class FakeAuthServer {
  readonly issued: string[] = [];
  readonly revoked: string[] = [];
  private readonly codes = new Map<string, { challenge: string; redirect: string }>();
  private readonly liveAccess = new Set<string>();
  private readonly liveRefresh = new Set<string>();
  private origin = "";

  constructor(private readonly clientId = "genie-mcp-stdio") {}

  bind(origin: string): void {
    this.origin = origin;
  }

  acceptsBearer(authorization: string | undefined): boolean {
    return authorization !== undefined && this.liveAccess.has(authorization.replace(/^Bearer /, ""));
  }

  expireAccessTokens(): void {
    this.liveAccess.clear();
  }

  /** Returns true when the request was one of the auth server's routes. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", this.origin);
    switch (url.pathname) {
      case "/.well-known/oauth-protected-resource/mcp":
        return json(res, {
          resource: `${this.origin}/mcp`,
          authorization_servers: [`${this.origin}/oauth`],
          scopes_supported: ["genie:ask"],
        });
      case "/.well-known/oauth-authorization-server/oauth":
        return json(res, {
          issuer: `${this.origin}/oauth`,
          authorization_endpoint: `${this.origin}/oauth/authorize`,
          token_endpoint: `${this.origin}/oauth/token`,
          revocation_endpoint: `${this.origin}/oauth/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["genie:ask"],
        });
      case "/oauth/authorize":
        return this.authorize(url, res);
      case "/oauth/token":
        return this.token(await form(req), res);
      case "/oauth/revoke": {
        const body = await form(req);
        const token = body.get("token") ?? "";
        this.revoked.push(token);
        this.liveRefresh.delete(token);
        res.writeHead(200).end();
        return true;
      }
      default:
        return false;
    }
  }

  private authorize(url: URL, res: ServerResponse): boolean {
    const q = url.searchParams;
    const redirect = new URL(q.get("redirect_uri") ?? "");
    const registered =
      q.get("client_id") === this.clientId &&
      redirect.protocol === "http:" &&
      redirect.hostname === "127.0.0.1" &&
      redirect.pathname === "/callback" &&
      q.get("code_challenge_method") === "S256" &&
      q.get("response_type") === "code" &&
      q.get("scope") === "genie:ask" &&
      q.get("resource") === `${this.origin}/mcp`;
    if (!registered) {
      res.writeHead(400).end("unregistered client or redirect");
      return true;
    }
    const code = randomUUID();
    this.codes.set(code, { challenge: q.get("code_challenge") ?? "", redirect: redirect.href });
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { location: redirect.href }).end();
    return true;
  }

  private token(body: URLSearchParams, res: ServerResponse): boolean {
    if (body.get("client_id") !== this.clientId) return json(res, { error: "invalid_grant" }, 400);
    if (body.get("grant_type") === "authorization_code") {
      const code = this.codes.get(body.get("code") ?? "");
      this.codes.delete(body.get("code") ?? "");
      const verifier = body.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (code === undefined || code.challenge !== challenge || code.redirect !== body.get("redirect_uri")) {
        return json(res, { error: "invalid_grant" }, 400);
      }
      return json(res, this.issue());
    }
    if (body.get("grant_type") === "refresh_token") {
      const presented = body.get("refresh_token") ?? "";
      if (!this.liveRefresh.delete(presented)) return json(res, { error: "invalid_grant" }, 400);
      return json(res, this.issue());
    }
    return json(res, { error: "unsupported_grant_type" }, 400);
  }

  /** The refresh token that goes with the newest access token in `issued`. */
  get latestRefresh(): string {
    return `refresh-${this.issued.length}`;
  }

  private issue(): Record<string, unknown> {
    const access = `access-${this.issued.length + 1}`;
    const refresh = `refresh-${this.issued.length + 1}`;
    this.issued.push(access);
    this.liveAccess.add(access);
    this.liveRefresh.add(refresh);
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: 3600, scope: "genie:ask" };
  }
}

function json(res: ServerResponse, body: unknown, status = 200): boolean {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  return true;
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
