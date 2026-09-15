# genie-mcp-stdio

Genie for any stdio-only MCP host.

[Genie](https://genie.paymanai.com) is Payman's payments agent. It is reachable as a
remote MCP server (`https://genie.paymanai.com/mcp`, Streamable HTTP) exposing one tool,
`ask_genie`. Many desktop agent hosts still only launch **local stdio** MCP servers —
[OpenMausBot](https://github.com/milind-soni/OpenMausBot), Claude Desktop, Codex CLI and
others. This package is the missing inch: a local process that speaks stdio to the host
and Streamable HTTP to Genie, forwarding tools verbatim and relaying Genie's
elicitation prompts back to the host when the host supports them.

It decides nothing and stores nothing. Credentials go in environment variables, are
attached as headers on the way to Genie, and never appear in tool output or logs.

## Quick start

```json
{
  "mcpServers": {
    "genie": {
      "command": "npx",
      "args": ["-y", "@paymanai/genie-mcp-stdio"],
      "env": {
        "GENIE_INTEGRATION_KEY": "…",
        "GENIE_CUSTOMER_ID": "…",
        "GENIE_CUSTOMER_EMAIL": "you@example.com"
      }
    }
  }
}
```

That block works, as-is, in:

| Host | Where it goes |
|---|---|
| OpenMausBot | `~/.openmausbot/config.json` — or Settings → Custom MCP servers. See [docs/hosts/openmausbot.md](docs/hosts/openmausbot.md). |
| Claude Desktop | `claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |
| Codex CLI | `~/.codex/config.toml` (`[mcp_servers.genie]`, same `command`/`args`/`env` keys) |

Then ask the agent anything Genie can do — “pay my rent from checking”, “what did I
spend at Lyft last month” — and it calls `ask_genie`.

## Configuration

Exactly one credential. The bridge refuses to start with none or both, because Genie
refuses a request that carries both.

| Variable | Meaning |
|---|---|
| `GENIE_INTEGRATION_KEY` | Managed Genie integration key (created in Payman Studio under an organization). Sent as `x-paygent-mcp-access-key`. |
| `GENIE_CUSTOMER_ID` | Required with the key: the Genie account holder this bridge acts for. Sent as `x-paygent-mcp-customer-id`. |
| `GENIE_CUSTOMER_EMAIL` | Optional with the key. Sent as `x-paygent-mcp-customer-email`. |
| `GENIE_ACCESS_TOKEN` | A Genie account OAuth access token (`yuki:ask` scope). Sent as `Authorization: Bearer`. |
| `GENIE_MCP_URL` | Defaults to `https://genie.paymanai.com/mcp`. Must be `https`; plain `http` is accepted only for loopback (local Genie stacks). |

Which one should you use? Today, the **integration key** is the path that works end to
end for a desktop user: an organization creates the key in Studio and hands it to the
person along with their customer ID. The **access token** path exists so the bridge is
ready for account-holder sign-in; Genie's authorization server currently issues tokens
only to preregistered OAuth clients and does not issue refresh tokens, so a pasted
token expires and has to be replaced. Interactive sign-in from the bridge itself
(loopback PKCE, registered via `GENIE_OAUTH_ADDITIONAL_CLIENTS` on the account server)
is the next release.

## What the host sees

- Tools: whatever Genie lists — today exactly `ask_genie`. `tools/list_changed` is
  forwarded.
- Elicitation: Genie asks the person to connect their account and pick a finance
  provider on first use. If the host declared the `elicitation` capability the prompt
  is relayed to it; otherwise Genie's reply explains what to do instead.
- Errors: a rejected credential surfaces as an MCP error naming the environment
  variables to check, never the values. The bridge starts even when Genie is
  unreachable, so a misconfiguration shows up on the first call rather than as a
  silent missing server.

## Security notes

- One session per bridge process, bound by Genie to the authenticated caller. Restarting
  the host restarts the session.
- Genie never returns a bank credential to a model; the bridge never sees one either.
  This package only moves JSON-RPC.
- Keep the config file private (OpenMausBot writes it `0600`). Scope the integration
  key to the person and revoke it in Studio when done.

## Development

```bash
nvm use            # Node 24
npm install
npm test           # builds, then node:test against an in-process fake Genie
```

`test/fixture.ts` is a small Streamable HTTP MCP server with Genie's admission rule
(exactly one credential or `401` with a Bearer challenge) and an `ask_genie` that can
elicit on the standalone stream, the way Genie does.

## License

MIT.
