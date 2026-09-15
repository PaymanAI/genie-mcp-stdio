# Genie in OpenMausBot

> **Have a coding agent do this.** Paste into it:
> `Integrate Genie into OpenMausBot by following the "For agents" section of https://raw.githubusercontent.com/PaymanAI/genie-mcp-stdio/main/README.md exactly.`
> The rest of this page is the same procedure for humans.

[OpenMausBot](https://github.com/milind-soni/OpenMausBot) launches custom MCP servers as
local stdio commands and does not yet accept remote MCP URLs. `genie-mcp-stdio` bridges
that gap so any bot in the sidebar can call Genie.

## 1. Add the server

Either open **Settings → Custom MCP servers** and add a server named `genie` with command
`npx` and arguments `-y @paymanai/genie-mcp-stdio` — no environment variables — or write
the same thing into `~/.openmausbot/config.json`:

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

## 2. Sign in

The first time a bot calls Genie, your browser opens on Genie's sign-in and consent page.
Approve it and return to OpenMausBot; the bot's message completes. The bridge stores a
refresh token in `~/.config/genie-mcp-stdio/credentials.json` (mode `0600`) and keeps you
signed in for as long as you keep using it (90 days from the last use).

If you would rather not have a bot's first message wait on a browser, sign in first from
a terminal:

```bash
npx -y @paymanai/genie-mcp-stdio login
```

## 3. Enable it for a bot

Custom servers are global; each bot's **Tools** settings narrow which enabled servers it
sees. Turn `genie` on for the bot you want to pay with.

## 4. Try it

Send the bot something Genie handles: “what's my checking balance?”. Once signed in, Genie
asks you to connect a finance provider the first time. If the bot's engine
supports MCP elicitation the prompt appears in the chat; otherwise Genie's reply
contains the link to complete the connection, after which the next message succeeds.

## Signing out

```bash
npx -y @paymanai/genie-mcp-stdio logout
```

revokes the sign-in at Genie and deletes the local file. Do this before handing the
machine to someone else.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| The bot's first Genie message hangs | The browser sign-in is waiting; look for the window, or check the bridge's stderr for the URL. It gives up after fifteen minutes. |
| `Genie no longer accepts the stored sign-in; signing in again.` | The refresh token expired or was revoked; the browser opens again. |
| Tool call fails with `Genie rejected the bridge credential (HTTP 401)` | Only in the explicit `GENIE_ACCESS_TOKEN` / `GENIE_INTEGRATION_KEY` modes: the value is wrong or revoked. Nothing about it is logged. |
| `Could not reach Genie` | Network, or a non-default `GENIE_MCP_URL`. |
| Browser does not open | Set `GENIE_BROWSER_COMMAND` to a command that opens URLs, or copy the URL from the bridge's stderr. |

Run the bridge by hand to see its stderr:

```bash
npx -y @paymanai/genie-mcp-stdio
```

It prints one `Serving Genie over stdio from …` line and waits for a host on stdin.
