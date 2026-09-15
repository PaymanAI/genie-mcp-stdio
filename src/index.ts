#!/usr/bin/env node
import { GenieBridge } from "./bridge.js";
import { ConfigError, describeConfig, readConfig, type BridgeConfig } from "./config.js";
import { CredentialStore } from "./credentials.js";
import { GenieAccountProvider } from "./oauth.js";

const USAGE = `usage: genie-mcp-stdio [login|logout]
  (no command)  serve Genie over stdio for an MCP host
  login         sign in to your Genie account in the browser and store the sign-in
  logout        revoke the stored sign-in at Genie and delete it locally`;

const log = (message: string): void => {
  process.stderr.write(`[genie-mcp-stdio] ${message}\n`);
};

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command !== undefined && command !== "login" && command !== "logout") {
    log(USAGE);
    process.exit(2);
  }
  const config = configOrExit();
  const store = new CredentialStore(CredentialStore.defaultPath(process.env));
  if (command !== undefined) {
    await accountCommand(command, config, store);
    return;
  }
  const bridge = new GenieBridge(config, log, store);
  const shutdown = (): void => {
    void bridge.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await bridge.serve();
  log(`Serving Genie over stdio from ${describeConfig(config)}`);
}

async function accountCommand(command: "login" | "logout", config: BridgeConfig, store: CredentialStore): Promise<void> {
  if (config.credential.kind !== "account") {
    log(`${command} applies to the signed-in account; unset GENIE_ACCESS_TOKEN / GENIE_INTEGRATION_KEY first.`);
    process.exit(2);
  }
  const account = new GenieAccountProvider(config.url, store, config.credential, log);
  if (command === "login") {
    await account.signIn();
    log(`Sign-in stored in ${store.path}`);
  } else {
    const revoked = await account.signOut();
    log(revoked ? "Signed out; Genie revoked the stored sign-in." : "Nothing was stored; nothing to revoke.");
  }
}

function configOrExit(): BridgeConfig {
  try {
    return readConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      log(error.message);
      process.exit(2);
    }
    throw error;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
