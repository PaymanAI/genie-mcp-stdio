# genie-mcp-stdio

Genie for any stdio-only MCP host.

> **Using an AI coding agent? Don't read this — hand it over.** Paste this into
> Claude Code, Codex, Cursor, or whatever you use:
>
> ```text
> Integrate Genie (Payman's payments agent) into my MCP host by following the
> "For agents" section of https://raw.githubusercontent.com/PaymanAI/genie-mcp-stdio/main/README.md
> exactly. Detect which host I use, add the server, run the sign-in, and verify.
> ```
>
> Your agent will add one server entry, open your browser once for you to sign in to
> Genie, and confirm the connection. Nothing to copy, no keys to obtain.

## For agents

You are integrating Genie into the user's MCP host. Follow these steps in order. Do not
improvise credentials: **there are no API keys, tokens or client ids to obtain or ask the
user for.** The sign-in is a browser flow the bridge runs itself.

### 1. Check prerequisites

```bash
node --version   # must print v20 or newer
```

If Node is missing or older than 20, install Node 20+ (or tell the user to) before
continuing. Nothing else is needed; `npx` fetches the bridge on first run.

### 2. Detect the host and add the server

Look for the host's config in this order; use the first that exists on the machine (or
the one the user named). Add the `genie` entry, merging into any existing `mcpServers`
object rather than replacing the file. **Add no `env` block.**

| Host | Config file | Entry |
|---|---|---|
| OpenMausBot | `~/.openmausbot/config.json` | JSON below, under `mcpServers` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` | JSON below, under `mcpServers` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` | JSON below, under `mcpServers` |
| Claude Code | run `claude mcp add genie -- npx -y @paymanai/genie-mcp-stdio` | — |
| Cursor | `~/.cursor/mcp.json` (global) or `<project>/.cursor/mcp.json` | JSON below, under `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON below, under `mcpServers` |
| Codex CLI | `~/.codex/config.toml` | TOML below |
| Anything else that launches stdio MCP servers | its MCP config | command `npx`, args `-y @paymanai/genie-mcp-stdio`, no env |

JSON entry:

```json
{
  "mcpServers": {
    "genie": {
      "command": "npx",
      "args": ["-y", "@paymanai/genie-mcp-stdio"]
    }
  }
}
```

TOML entry (Codex CLI):

```toml
[mcp_servers.genie]
command = "npx"
args = ["-y", "@paymanai/genie-mcp-stdio"]
```

If the host supports remote MCP URLs natively with OAuth (some do), you may instead add
`https://genie.paymanai.com/mcp` as a remote server — but only if the host lets Genie
preregister its client id; see [Integrating Genie without the bridge](#integrating-genie-without-the-bridge).
When in doubt, use the bridge above; it works everywhere.

### 3. Sign the user in

Run this in a terminal the user can see, and tell them a browser window will open:

```bash
npx -y @paymanai/genie-mcp-stdio login
```

It prints `Signed in to Genie.` and `Sign-in stored in …/genie-mcp-stdio/credentials.json`
on success. If no browser opens, give the user the URL printed after
`Sign in to Genie in your browser:`. It waits up to fifteen minutes. You can skip this step —
the bridge signs in on the first tool call instead — but running it now means the user's
first message doesn't stall on a browser.

### 4. Verify

Restart the host (or reload its MCP servers). Confirm a server named `genie` exposing the
tool `ask_genie` appears. Then have the user (or the host's agent) send Genie a harmless
message such as "what can you do?" and check that a reply comes back. On first use Genie
asks the user to connect a finance provider — that is expected and happens in Genie's own
UI, not in the host.

### 5. Report back

Tell the user, in one or two lines: which config file you changed, that they are signed
in to Genie, and that `npx -y @paymanai/genie-mcp-stdio logout` signs them out everywhere.

### Do not

- Do not set `GENIE_ACCESS_TOKEN`, `GENIE_INTEGRATION_KEY`, `GENIE_OAUTH_CLIENT_ID` or any
  other `GENIE_*` variable. They exist for Payman's own deployments and integrators; a
  person's setup uses none of them, and asking the user for such values is a red flag.
- Do not copy `credentials.json` into the host's config or anywhere else.
- Do not ask the user for their Genie password; the bridge never sees it either.

---

## What this is

[Genie](https://genie.paymanai.com) is Payman's payments agent. It is reachable as a
remote MCP server (`https://genie.paymanai.com/mcp`, Streamable HTTP) exposing one tool,
`ask_genie`. Many desktop agent hosts still only launch **local stdio** MCP servers —
[OpenMausBot](https://github.com/milind-soni/OpenMausBot), Claude Desktop, Codex CLI and
others. This package is the missing inch: a local process that speaks stdio to the host
and Streamable HTTP to Genie, forwarding tools verbatim and relaying Genie's
elicitation prompts back to the host when the host supports them.

It decides nothing. You sign in to your own Genie account once in the browser; the bridge
keeps that sign-in in a private file and never puts a secret in a host's configuration,
tool output or logs.

## Commands

| Command | What it does |
|---|---|
| `npx -y @paymanai/genie-mcp-stdio` | Serve Genie over stdio. This is what hosts run. |
| `npx -y @paymanai/genie-mcp-stdio login` | Sign in now: opens the browser, waits up to fifteen minutes for the callback, stores the sign-in. |
| `npx -y @paymanai/genie-mcp-stdio logout` | Revoke the sign-in at Genie and delete the local copy. |

All diagnostics go to stderr, prefixed `[genie-mcp-stdio]`; stdout is reserved for MCP.

## How the sign-in works

The bridge is a preregistered *native* OAuth client at Genie (`genie-mcp-stdio`):
authorization code with S256 PKCE, a loopback redirect on a random port (RFC 8252), and a
**refresh token** that Genie rotates on every use and lets live for 90 days from the last
use. Access tokens last one hour and are renewed silently; you only see the browser again
if you have not used Genie for 90 days, sign out, or Genie revokes the sign-in.

The refresh token is stored in `~/.config/genie-mcp-stdio/credentials.json`
(`$XDG_CONFIG_HOME` respected), mode `0600`, keyed by Genie URL. It is never written to a
host's configuration, tool output or logs. `logout` revokes it at Genie (RFC 7009) before
deleting it, so a copied file stops working too.

## Configuration (you almost certainly don't need this)

A person's setup uses no environment variables at all. These exist for Payman's own local
Genie stacks, CI, and organizations integrating on their own behalf rather than as a person:

| Variable | Meaning |
|---|---|
| `GENIE_MCP_URL` | Defaults to `https://genie.paymanai.com/mcp`. Must be `https`; plain `http` is accepted only for loopback (local Genie stacks). |
| `GENIE_OAUTH_CLIENT_ID` | Leave unset. Defaults to `genie-mcp-stdio`, the bridge's own preregistered public client id (not a secret). Only a self-hosted Genie, or a fork we registered separately, sets this. |
| `GENIE_BROWSER_COMMAND` | Command (space-separated) that receives the sign-in URL; defaults to the OS opener. |
| `GENIE_CREDENTIALS_FILE` | Where the sign-in is stored; defaults as above. |
| `GENIE_ACCESS_TOKEN` | Bypass the account sign-in with a Genie OAuth access token you obtained elsewhere (expires; no refresh). |
| `GENIE_INTEGRATION_KEY` + `GENIE_CUSTOMER_ID` (+ `GENIE_CUSTOMER_EMAIL`) | Bypass the account sign-in with a managed integration key; this identifies an organization's integration acting for a customer, not a person's own account. |

Setting both bypass variables is refused, because Genie refuses a request that carries both.

## What the host sees

- Tools: whatever Genie lists — today exactly `ask_genie`. `tools/list_changed` is
  forwarded.
- Elicitation: Genie asks the person to connect their account and pick a finance
  provider on first use. If the host declared the `elicitation` capability the prompt
  is relayed to it; otherwise Genie's reply explains what to do instead.
- Errors: a rejected credential surfaces as an MCP error naming what to check, never a
  token value. The bridge starts even when Genie is unreachable, so a problem shows up on
  the first call rather than as a silent missing server. If Genie stops accepting the
  stored sign-in, the bridge opens the browser again rather than failing.

## Security notes

- One session per bridge process, bound by Genie to the authenticated caller. Restarting
  the host restarts the session.
- Genie never returns a bank credential to a model; the bridge never sees one either.
  This package only moves JSON-RPC.
- The bridge collapses concurrent token refreshes into one request: the MCP session's
  POST and its notification stream can both meet a `401` at the same moment, and Genie
  treats a second use of a rotated refresh token as a replay that revokes the sign-in.
- `logout` when you stop using a machine; the sign-in is then dead at Genie, not just
  deleted locally.

## Integrating Genie without the bridge

If you maintain a host and want to connect to Genie's remote MCP server directly — the
better long-term answer, and the one OpenMausBot has on its roadmap — here is what Genie
expects. It is standard MCP authorization; nothing here is Genie-specific except the
client registration.

1. **Transport.** Streamable HTTP at `https://genie.paymanai.com/mcp`. POSTs answer with
   JSON; notifications and elicitation requests arrive on the standalone `GET` SSE stream,
   so open it after `initialize`. Sessions are bound to the authenticated caller via
   `Mcp-Session-Id`; a new process needs a new session.
2. **Discovery.** An unauthenticated request returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://genie.paymanai.com/.well-known/oauth-protected-resource/mcp", scope="yuki:ask"`
   (RFC 9728). That document names the authorization server, whose RFC 8414 metadata lists
   the authorize, token, revocation and JWKS endpoints.
3. **Authorization.** Authorization code with S256 PKCE, `token_endpoint_auth_method: none`,
   scope `yuki:ask`, and the `resource` parameter set to the MCP URL (RFC 8707). There is no
   dynamic client registration: **ask us to preregister your host** with its `client_id`,
   display name and exact redirect URIs (open an issue on this repository). Registered
   loopback redirects for native apps match on any port; everything else matches exactly.
   Native clients receive a refresh token (90 days sliding, rotated on every use — send the
   new one back next time, and never reuse an old one, which Genie treats as a replay and
   revokes the sign-in). Access tokens are one-hour ES256 JWTs.
4. **Elicitation.** Declare the `elicitation` capability if you can render a form: Genie
   uses it once per account to have the person connect a finance provider, and carries a
   `connectionUrl` in `_meta` you may open for them. Without it, `ask_genie` replies with
   instructions instead.
5. **Test against the real thing.** This bridge's [`test/fixture.ts`](test/fixture.ts) and
   [`test/fakeAuthServer.ts`](test/fakeAuthServer.ts) are a faithful local stand-in for the
   above if you want an offline test; the production server behaves the same way.

## Development

```bash
nvm use            # Node 24
npm install
npm test           # builds, then node:test against an in-process fake Genie
```

`test/fixture.ts` is a small Streamable HTTP MCP server with Genie's admission rule
(exactly one credential or `401` with a Bearer challenge) and an `ask_genie` that can
elicit on the standalone stream, the way Genie does. `test/fakeAuthServer.ts` is the slice
of Genie's authorization server the sign-in uses — discovery, PKCE, refresh rotation,
revocation — and `test/browser.ts` stands in for the person's browser.

## License

MIT.
