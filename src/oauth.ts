import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import {
  auth,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { CredentialStore } from "./credentials.js";

export const DEFAULT_CLIENT_ID = "genie-mcp-stdio";
// `genie:ask` talks to Genie; `genie:self` lets the assistant read and manage its own agent
// record (name, connection access, access requests) without a browser trip (ADR-0026).
export const SCOPE = "genie:ask genie:self";
const CALLBACK_PATH = "/callback";
// A first sign-in can include account creation and a passkey; five minutes proved too short.
const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000;

export type Log = (message: string) => void;

export interface AccountOptions {
  clientId: string;
  /** Space-separated command that gets the authorization URL appended; defaults to the OS opener. */
  browserCommand: string | undefined;
}

/**
 * The SDK drives discovery, PKCE, code exchange and refresh; this class supplies the
 * preregistered native client, the loopback redirect, the token file and the browser.
 * Genie preregisters `http://127.0.0.1/callback`; as a native client any port matches.
 */
export class GenieAccountProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  private port: number | undefined;
  private pendingState: string | undefined;
  private listener: Server | undefined;
  private pending: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  private inflightRefresh: { token: string; response: Promise<Response> } | undefined;

  constructor(
    private readonly server: URL,
    private readonly store: CredentialStore,
    private readonly options: AccountOptions,
    private readonly log: Log,
  ) {}

  /**
   * Always defined: the SDK treats an absent redirect as a non-interactive client and then
   * skips the refresh grant entirely. Outside a sign-in the registered port-less form stands in.
   */
  get redirectUrl(): URL {
    return new URL(`http://127.0.0.1${this.port === undefined ? "" : `:${this.port}`}${CALLBACK_PATH}`);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Genie MCP stdio bridge",
      redirect_uris: [this.redirectUrl.href],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    };
  }

  state(): string {
    this.pendingState = randomBytes(24).toString("base64url");
    return this.pendingState;
  }

  clientInformation(): OAuthClientInformationMixed {
    return { client_id: this.options.clientId };
  }

  tokens(): OAuthTokens | undefined {
    return this.store.read(this.server);
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.write(this.server, tokens);
  }

  redirectToAuthorization(url: URL): void {
    // Only a running sign-in can receive the callback; the bridge starts one on this signal.
    if (this.port === undefined) return;
    this.log(`Sign in to Genie in your browser: ${url.href}`);
    openBrowser(url, this.options.browserCommand, this.log);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (this.verifier === undefined) throw new Error("No sign-in in progress");
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (scope === "all" || scope === "tokens") this.store.clear(this.server);
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
  }

  /**
   * Fetch for the transport that collapses concurrent refreshes of the same refresh token
   * into one request. The transport's POST and its standalone GET stream can both meet a
   * 401 at once; two refreshes with one token would make Genie treat the second as a
   * replay and revoke the whole family.
   */
  readonly fetch: typeof fetch = async (input, init) => {
    const token = refreshTokenIn(init?.body);
    if (token === undefined) return fetch(input, init);
    if (this.inflightRefresh?.token !== token) {
      const response = fetch(input, init);
      this.inflightRefresh = { token, response };
      response.catch(() => {
        if (this.inflightRefresh?.response === response) this.inflightRefresh = undefined;
      });
    }
    return (await this.inflightRefresh.response).clone();
  };

  /**
   * Interactive sign-in: loopback listener, browser, code exchange, tokens saved. The
   * listener stays open afterwards (same port) so a browser that arrives after a timeout
   * gets an explanation page rather than a refused connection.
   */
  async signIn(timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<void> {
    await this.listen();
    try {
      const codePromise = this.awaitCode(timeoutMs);
      const started = await auth(this, { serverUrl: this.server, scope: SCOPE });
      if (started === "AUTHORIZED") return;
      const code = await codePromise;
      const finished = await auth(this, { serverUrl: this.server, authorizationCode: code, scope: SCOPE });
      if (finished !== "AUTHORIZED") throw new Error("Genie did not complete the sign-in");
      this.log("Signed in to Genie.");
    } finally {
      this.pending = undefined;
      this.pendingState = undefined;
      this.verifier = undefined;
    }
  }

  /** Stops the loopback listener; a later signIn starts a fresh one. */
  async close(): Promise<void> {
    const listener = this.listener;
    this.listener = undefined;
    this.port = undefined;
    if (listener !== undefined) await new Promise<void>((resolve) => listener.close(() => resolve()));
  }

  /** Ends the refresh-token family at Genie (RFC 7009) and forgets the local copy. */
  async signOut(fetchFn: typeof fetch = fetch): Promise<boolean> {
    const tokens = this.tokens();
    this.store.clear(this.server);
    if (tokens?.refresh_token === undefined) return false;
    const resource = await discoverOAuthProtectedResourceMetadata(this.server, undefined, fetchFn);
    const issuer = resource.authorization_servers?.[0];
    if (issuer === undefined) throw new Error("Genie did not name its authorization server");
    const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn });
    // OpenID discovery metadata has no revocation field; Genie serves RFC 8414 metadata.
    const endpoint = metadata !== undefined && "revocation_endpoint" in metadata ? metadata.revocation_endpoint : undefined;
    if (endpoint === undefined) throw new Error("Genie does not advertise a revocation endpoint");
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        token: tokens.refresh_token,
        token_type_hint: "refresh_token",
      }),
    });
    if (!response.ok) throw new Error(`Genie refused the revocation (HTTP ${response.status})`);
    return true;
  }

  private listen(): Promise<void> {
    if (this.listener !== undefined) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => this.callback(request, response));
      // Never keeps a `login` process alive on its own once the sign-in has finished or failed.
      server.unref();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") return reject(new Error("no loopback port"));
        this.port = address.port;
        this.listener = server;
        resolve();
      });
    });
  }

  private awaitCode(timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error(`Timed out after ${Math.round(timeoutMs / 60_000)} minutes waiting for the browser sign-in`));
      }, timeoutMs);
      this.pending = {
        resolve: (code) => {
          clearTimeout(timer);
          resolve(code);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  private callback(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const pending = this.pending;
    if (pending === undefined || state !== this.pendingState) {
      response.writeHead(410, HTML).end(page(
        "This sign-in expired.",
        "Your agent waited for you to finish signing in, then gave up. Nothing was connected. " +
          "Go back to your agent and ask it to connect to Genie again; the next sign-in will be quicker.",
      ));
      return;
    }
    if (code === null || error !== null) {
      response.writeHead(400, HTML).end(page("Sign-in failed.", `Genie reported: ${escapeHtml(error ?? "invalid callback")}. You can close this tab.`));
      pending.reject(new Error(`Genie sign-in failed: ${error ?? "invalid callback"}`));
      return;
    }
    response.writeHead(200, HTML).end(page("Signed in.", "You can close this tab and return to your agent."));
    pending.resolve(code);
  }
}

const HTML = { "content-type": "text/html; charset=utf-8" };

function page(title: string, body: string): string {
  return (
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
    `<title>Genie — ${escapeHtml(title)}</title>` +
    "<body style='margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ef;font:16px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#1f3a3d'>" +
    "<main style='max-width:32rem;padding:2rem;background:#fbfaf7;border:1px solid #e3e0d8;border-radius:12px'>" +
    `<h1 style='margin:0 0 .5rem;font-size:1.6rem'>${escapeHtml(title)}</h1><p style='margin:0'>${body}</p></main>`
  );
}

function refreshTokenIn(body: BodyInit | null | undefined): string | undefined {
  const form =
    body instanceof URLSearchParams ? body : typeof body === "string" ? new URLSearchParams(body) : undefined;
  return form?.get("grant_type") === "refresh_token" ? (form.get("refresh_token") ?? undefined) : undefined;
}

function openBrowser(url: URL, command: string | undefined, log: Log): void {
  const [file, ...args] = command === undefined ? defaultOpener() : command.trim().split(/\s+/);
  if (file === undefined) return;
  const child = spawn(file, [...args, url.href], { stdio: "ignore", detached: false });
  child.on("error", (error) => log(`Could not open a browser (${error.message}); open the URL above yourself.`));
}

function defaultOpener(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["open"];
    case "win32":
      return ["cmd", "/c", "start", ""];
    default:
      return ["xdg-open"];
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
