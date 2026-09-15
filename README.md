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

## Quick start

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
you signed in. To sign in ahead of time (or on a machine where the host can't reach your
browser), run:

```bash
npx -y @paymanai/genie-mcp-stdio login
```

and to end the sign-in — locally and at Genie — run `npx -y @paymanai/genie-mcp-stdio logout`.

That block works, as-is, in:

| Host | Where it goes |
|---|---|
| OpenMausBot | `~/.openmausbot/config.json` — or Settings → Custom MCP servers. See [docs/hosts/openmausbot.md](docs/hosts/openmausbot.md). |
| Claude Desktop | `claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |
| Codex CLI | `~/.codex/config.toml` (`[mcp_servers.genie]`, same `command`/`args` keys) |

Then ask the agent anything Genie can do — “pay my rent from checking”, “what did I
spend at Lyft last month” — and it calls `ask_genie`.

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
