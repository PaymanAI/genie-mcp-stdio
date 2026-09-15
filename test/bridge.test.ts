import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { FakeAuthServer } from "./fakeAuthServer.js";
import { FakeGenie } from "./fixture.js";

const BIN = fileURLToPath(new URL("../src/index.js", import.meta.url));
const BROWSER = fileURLToPath(new URL("./browser.js", import.meta.url));

async function hostFor(env: Record<string, string>, elicitation = false): Promise<Client> {
  const host = new Client({ name: "host", version: "0" }, { capabilities: elicitation ? { elicitation: {} } : {} });
  if (elicitation) {
    host.setRequestHandler(ElicitRequestSchema, async () => ({ action: "accept", content: { account: "checking" } }));
  }
  await host.connect(
    new StdioClientTransport({ command: process.execPath, args: [BIN], env: { ...cleanEnv(), ...env }, stderr: "pipe" }),
  );
  return host;
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("GENIE_")) env[k] = v;
  return env;
}

describe("integration-key mode", () => {
  const genie = new FakeGenie((h) => h["x-paygent-mcp-access-key"] === "key-1");
  let host: Client;
  before(async () => {
    const url = await genie.start();
    host = await hostFor({
      GENIE_MCP_URL: url.href,
      GENIE_INTEGRATION_KEY: "key-1",
      GENIE_CUSTOMER_ID: "cust-1",
      GENIE_CUSTOMER_EMAIL: "p@example.com",
    });
  });
  after(async () => {
    await host.close();
    await genie.stop();
  });

  test("lists and calls ask_genie through the bridge with the Genie headers", async () => {
    const tools = await host.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name), ["ask_genie"]);
    const result = await host.callTool({ name: "ask_genie", arguments: { message: "pay rent" } });
    assert.deepEqual(result.content, [{ type: "text", text: "genie heard: pay rent" }]);
    const first = genie.seen[0]!.headers;
    assert.equal(first["x-paygent-mcp-customer-id"], "cust-1");
    assert.equal(first["x-paygent-mcp-customer-email"], "p@example.com");
    assert.equal(first.authorization, undefined);
  });
});

describe("oauth mode with elicitation relay", () => {
  const genie = new FakeGenie((h) => h.authorization === "Bearer tok-1", true);
  let host: Client;
  before(async () => {
    const url = await genie.start();
    host = await hostFor({ GENIE_MCP_URL: url.href, GENIE_ACCESS_TOKEN: "tok-1" }, true);
  });
  after(async () => {
    await host.close();
    await genie.stop();
  });

  test("relays Genie's elicitation to the host and returns the answer", async () => {
    const result = await host.callTool({ name: "ask_genie", arguments: { message: "move $5" } });
    assert.deepEqual(result.content, [{ type: "text", text: "genie heard: move $5 [accept:checking]" }]);
    assert.equal(genie.seen[0]!.headers.authorization, "Bearer tok-1");
    assert.equal(genie.seen[0]!.headers["x-paygent-mcp-access-key"], undefined);
  });
});

describe("rejected credential", () => {
  const genie = new FakeGenie(() => false);
  let host: Client;
  before(async () => {
    const url = await genie.start();
    host = await hostFor({ GENIE_MCP_URL: url.href, GENIE_ACCESS_TOKEN: "bad" });
  });
  after(async () => {
    await host.close();
    await genie.stop();
  });

  test("starts cleanly and surfaces the 401 as a tool error naming the env vars", async () => {
    await assert.rejects(
      host.listTools(),
      (error: unknown) =>
        error instanceof McpError &&
        error.message ===
          "MCP error -32600: Genie rejected the bridge credential (HTTP 401). Check GENIE_ACCESS_TOKEN or GENIE_INTEGRATION_KEY.",
    );
  });
});

describe("signed-in account mode", () => {
  const authServer = new FakeAuthServer();
  const genie = new FakeGenie((h) => authServer.acceptsBearer(h.authorization as string | undefined), false, authServer);
  const credentialsFile = join(mkdtempSync(join(tmpdir(), "genie-mcp-stdio-")), "credentials.json");
  let url: URL;
  let host: Client;
  const env = (): Record<string, string> => ({
    GENIE_MCP_URL: url.href,
    GENIE_CREDENTIALS_FILE: credentialsFile,
    GENIE_BROWSER_COMMAND: `${process.execPath} ${BROWSER}`,
  });
  before(async () => {
    url = await genie.start();
    host = await hostFor(env());
  });
  after(async () => {
    await host.close();
    await genie.stop();
  });

  test("signs in through the browser on first use and stores only a 0600 file", async () => {
    assert.equal(existsSync(credentialsFile), false);
    const result = await host.callTool({ name: "ask_genie", arguments: { message: "balance?" } });
    assert.deepEqual(result.content, [{ type: "text", text: "genie heard: balance?" }]);
    assert.equal(statSync(credentialsFile).mode & 0o777, 0o600);
    const stored = JSON.parse(readFileSync(credentialsFile, "utf8")) as Record<string, { refresh_token: string }>;
    assert.equal(stored[url.href]?.refresh_token, "refresh-1");
    assert.equal(genie.seen.at(-1)?.headers.authorization, "Bearer access-1");
  });

  test("refreshes silently when Genie stops accepting the access token", async () => {
    // The bridge's standalone SSE stream may also hit the 401 and refresh once on its own,
    // so assert on the newest issued pair rather than on fixed numbering.
    const before = authServer.issued.length;
    authServer.expireAccessTokens();
    const result = await host.callTool({ name: "ask_genie", arguments: { message: "again" } });
    assert.deepEqual(result.content, [{ type: "text", text: "genie heard: again" }]);
    assert.ok(authServer.issued.length > before);
    assert.equal(genie.seen.at(-1)?.headers.authorization, `Bearer ${authServer.issued.at(-1)}`);
    const stored = JSON.parse(readFileSync(credentialsFile, "utf8")) as Record<string, { refresh_token: string }>;
    assert.equal(stored[url.href]?.refresh_token, authServer.latestRefresh);
  });

  test("logout revokes the refresh token at Genie and deletes the file", async () => {
    // Asynchronous: the fake Genie answering the revocation lives in this same process.
    const run = await promisify(execFile)(process.execPath, [BIN, "logout"], { env: { ...cleanEnv(), ...env() } });
    assert.deepEqual(authServer.revoked, [authServer.latestRefresh]);
    assert.equal(existsSync(credentialsFile), false);
    assert.match(run.stderr, /Signed out/);
  });
});

test("an unknown command prints usage and exits 2", () => {
  const run = spawnSync(process.execPath, [BIN, "frobnicate"], { env: cleanEnv(), encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /usage: genie-mcp-stdio/);
});
