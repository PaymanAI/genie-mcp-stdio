# Genie in OpenMausBot

[OpenMausBot](https://github.com/milind-soni/OpenMausBot) launches custom MCP servers as
local stdio commands and does not yet accept remote MCP URLs. `genie-mcp-stdio` bridges
that gap so any bot in the sidebar can call Genie.

## 1. Get a credential

Ask the organization running Genie for you to create a managed integration key in
Payman Studio and give you the key together with your customer ID (and the email on
your Genie account). Keep the key private; it identifies the organization and you.

## 2. Add the server

Either open **Settings → Custom MCP servers**, add a server named `genie` with command
`npx`, arguments `-y @paymanai/genie-mcp-stdio`, and the three environment variables —
or write the same thing into `~/.openmausbot/config.json`:

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

OpenMausBot keeps the file `0600` and shows only the variable names in its UI.

## 3. Enable it for a bot

Custom servers are global; each bot's **Tools** settings narrow which enabled servers it
sees. Turn `genie` on for the bot you want to pay with.

## 4. Try it

Send the bot something Genie handles: “what's my checking balance?”. On first use Genie
asks you to connect your account and choose a finance provider. If the bot's engine
supports MCP elicitation the prompt appears in the chat; otherwise Genie's reply
contains the link to complete the connection, after which the next message succeeds.

## Troubleshooting

| Symptom | Meaning |
|---|---|
| Server fails to start, log says `No Genie credential` | The `env` block is missing or empty. |
| Tool call fails with `Genie rejected the bridge credential (HTTP 401)` | Wrong or revoked key/token. Nothing about the value is logged. |
| `GENIE_INTEGRATION_KEY requires GENIE_CUSTOMER_ID` | Add your customer ID. |
| `Could not reach Genie` | Network, or a non-default `GENIE_MCP_URL`. |

Run the bridge by hand to see its stderr:

```bash
GENIE_INTEGRATION_KEY=… GENIE_CUSTOMER_ID=… npx -y @paymanai/genie-mcp-stdio
```

It prints one `Serving Genie over stdio from …` line and waits for a host on stdin.
