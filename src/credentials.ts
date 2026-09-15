import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * The person's Genie sign-in, keyed by MCP server URL, in a 0600 file under their config
 * directory. Nothing here ever reaches host configuration, tool output or logs.
 */
export class CredentialStore {
  constructor(readonly path: string) {}

  static defaultPath(env: NodeJS.ProcessEnv): string {
    const explicit = env.GENIE_CREDENTIALS_FILE?.trim();
    if (explicit) return explicit;
    const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
    return join(base, "genie-mcp-stdio", "credentials.json");
  }

  read(server: URL): OAuthTokens | undefined {
    return this.load()[server.href];
  }

  write(server: URL, tokens: OAuthTokens): void {
    const all = this.load();
    all[server.href] = tokens;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }

  clear(server: URL): void {
    const all = this.load();
    delete all[server.href];
    if (Object.keys(all).length === 0) {
      rmSync(this.path, { force: true });
      return;
    }
    writeFileSync(this.path, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  }

  private load(): Record<string, OAuthTokens> {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return {};
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, OAuthTokens>) : {};
    } catch {
      return {};
    }
  }
}
