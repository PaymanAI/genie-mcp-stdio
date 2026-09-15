import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CredentialStore } from "../src/credentials.js";
import { GenieAccountProvider } from "../src/oauth.js";
import { FakeAuthServer } from "./fakeAuthServer.js";
import { FakeGenie } from "./fixture.js";

const authServer = new FakeAuthServer();
const genie = new FakeGenie((h) => authServer.acceptsBearer(h.authorization as string | undefined), false, authServer);
let provider: GenieAccountProvider;
const logged: string[] = [];

before(async () => {
  const url = await genie.start();
  const store = new CredentialStore(join(mkdtempSync(join(tmpdir(), "genie-oauth-")), "credentials.json"));
  // `true` is a browser that opens nothing, so the sign-in can only time out.
  provider = new GenieAccountProvider(url, store, { clientId: "genie-mcp-stdio", browserCommand: "true" }, (m) => logged.push(m));
});
after(async () => {
  await provider.close();
  await genie.stop();
});

test("a browser arriving after the sign-in timed out gets an explanation, not a refused connection", async () => {
  await assert.rejects(provider.signIn(100), /Timed out after 0 minutes/);
  const callback = provider.redirectUrl;
  assert.notEqual(callback.port, "", "the listener stays up after the timeout");
  const late = await fetch(`${callback.href}?code=late&state=whatever`);
  assert.equal(late.status, 410);
  const body = await late.text();
  assert.match(body, /This sign-in expired/);
  assert.match(body, /ask it to connect to Genie again/);
  assert.doesNotMatch(body, /late/, "the code is never echoed");
});

test("the next attempt reuses the same port, and a wrong state is refused while it waits", async () => {
  const port = provider.redirectUrl.port;
  const seen = logged.length;
  const attempt = provider.signIn(2_000);
  attempt.catch(() => undefined);
  // Discovery runs first; the sign-in URL is logged once the browser would be opened.
  while (logged.length === seen) await new Promise((r) => setTimeout(r, 10));
  const url = logged.at(-1)?.match(/https?:\/\/\S+/)?.[0];
  assert.ok(url !== undefined, "the sign-in URL is logged");
  assert.equal(new URL(new URL(url).searchParams.get("redirect_uri") ?? "").port, port);
  const forged = await fetch(`${provider.redirectUrl.href}?code=x&state=not-the-pending-state`);
  assert.equal(forged.status, 410);
  const denied = await fetch(`${provider.redirectUrl.href}?error=access_denied&state=${new URL(url).searchParams.get("state")}`);
  assert.equal(denied.status, 400);
  assert.match(await denied.text(), /access_denied/);
  await assert.rejects(attempt, /access_denied/);
});
