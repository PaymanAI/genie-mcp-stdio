#!/usr/bin/env node
import { GenieBridge } from "./bridge.js";
import { ConfigError, describeConfig, readConfig } from "./config.js";

const log = (message: string): void => {
  process.stderr.write(`[genie-mcp-stdio] ${message}\n`);
};

async function main(): Promise<void> {
  let config;
  try {
    config = readConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      log(error.message);
      process.exit(2);
    }
    throw error;
  }
  const bridge = new GenieBridge(config, log);
  const shutdown = (): void => {
    void bridge.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await bridge.serve();
  log(`Serving Genie over stdio from ${describeConfig(config)}`);
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
