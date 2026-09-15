# genie-mcp-stdio

Genie for any stdio-only MCP host.

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

## Requirements

- Node.js 20 or newer on the machine running the host (`npx` comes with it).
- A Genie account — the sign-in page offers to create one.
- An MCP host that launches stdio servers. That is every host below; if yours can
  connect to remote MCP URLs directly, you don't need this bridge — see
  [Integrating Genie without the bridge](#integrating-genie-without-the-bridge).

## Quick start

Add this server to your host, then talk to the agent:

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

No secrets in the config. The first time the agent calls Genie, the bridge opens your
browser to sign in to your Genie account and approve the connection; after that it keeps
you signed in. Ask the agent anything Genie can do — “pay my rent from checking”, “what
did I spend at Lyft last month” — and it calls `ask_genie`.

To sign in ahead of time (or on a machine where the host can't reach your browser), run:

```bash
npx -y @paymanai/genie-mcp-stdio login
```

## Host-by-host

### OpenMausBot

Settings → **Custom MCP servers** → add `genie` with command `npx` and arguments
`-y @paymanai/genie-mcp-stdio`, or paste the Quick start block into
`~/.openmausbot/config.json`. Then enable `genie` in the bot's **Tools**. Full walkthrough
with troubleshooting: [docs/hosts/openmausbot.md](docs/hosts/openmausbot.md).

### Claude Desktop

Paste the Quick start block into `claude_desktop_config.json` (Claude → Settings →
Developer → Edit Config), which lives at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Restart Claude Desktop; Genie appears under the tools icon.

### Cursor

Paste the Quick start block into `~/.cursor/mcp.json` (all projects) or
`.cursor/mcp.json` in a project. Cursor supports MCP elicitation, so Genie's
“connect a finance provider” prompt appears in the chat.

### Codex CLI

Codex configures MCP servers in TOML. Add to `~/.codex/config.toml`:

```toml
[mcp_servers.genie]
command = "npx"
args = ["-y", "@paymanai/genie-mcp-stdio"]
```

### Any other stdio host

The bridge is a plain stdio MCP server: `command` is `npx`, `args` are
`-y @paymanai/genie-mcp-stdio`, no environment variables. If your host lets you set a
working directory, any directory is fine. If it runs servers without access to your
desktop session (a daemon, a container), run `login` once from a terminal as the same
user first, or set `GENIE_CREDENTIALS_FILE` to a path both can read.

## Commands

| Command | What it does |
|---|---|
| `npx -y @paymanai/genie-mcp-stdio` | Serve Genie over stdio. This is what hosts run. |
| `npx -y @paymanai/genie-mcp-stdio login` | Sign in now: opens the browser, waits up to five minutes for the callback, stores the sign-in. |
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

## Configuration

Nothing is required. These are for local Genie stacks, CI, and organizations integrating
on their own behalf rather than as a person:

| Variable | Meaning |
|---|---|
| `GENIE_MCP_URL` | Defaults to `https://genie.paymanai.com/mcp`. Must be `https`; plain `http` is accepted only for loopback (local Genie stacks). |
| `GENIE_OAUTH_CLIENT_ID` | Native client id preregistered at that Genie; defaults to `genie-mcp-stdio`. |
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
