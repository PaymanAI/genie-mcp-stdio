import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, DEFAULT_GENIE_MCP_URL, credentialHeaders, describeConfig, readConfig } from "../src/config.js";

test("defaults to the public Genie endpoint with an OAuth token", () => {
  const config = readConfig({ GENIE_ACCESS_TOKEN: " s3cr3t " });
  assert.equal(config.url.href, DEFAULT_GENIE_MCP_URL);
  assert.deepEqual(config.credential, { kind: "oauth", accessToken: "s3cr3t" });
  assert.deepEqual(credentialHeaders(config.credential), { authorization: "Bearer s3cr3t" });
  assert.equal(describeConfig(config).includes("s3cr3t"), false);
});

test("integration key needs the customer id and maps to the Genie headers", () => {
  assert.throws(() => readConfig({ GENIE_INTEGRATION_KEY: "k" }), ConfigError);
  const config = readConfig({
    GENIE_INTEGRATION_KEY: "k",
    GENIE_CUSTOMER_ID: "cust-1",
    GENIE_CUSTOMER_EMAIL: "a@b.c",
    GENIE_MCP_URL: "http://localhost:8082/mcp",
  });
  assert.deepEqual(credentialHeaders(config.credential), {
    "x-paygent-mcp-access-key": "k",
    "x-paygent-mcp-customer-id": "cust-1",
    "x-paygent-mcp-customer-email": "a@b.c",
  });
  assert.equal(describeConfig(config), "http://localhost:8082/mcp (integration key for customer cust-1)");
});

test("refuses no credential, two credentials, and a plaintext remote URL", () => {
  assert.throws(() => readConfig({}), /No Genie credential/);
  assert.throws(() => readConfig({ GENIE_ACCESS_TOKEN: "t", GENIE_INTEGRATION_KEY: "k" }), /only one/);
  assert.throws(
    () => readConfig({ GENIE_ACCESS_TOKEN: "t", GENIE_MCP_URL: "http://genie.example.com/mcp" }),
    /must be https/,
  );
  assert.throws(() => readConfig({ GENIE_ACCESS_TOKEN: "t", GENIE_MCP_URL: "nope" }), /not a valid URL/);
});
