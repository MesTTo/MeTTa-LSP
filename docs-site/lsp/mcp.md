# Agent setup (MCP)

The language server also runs as an MCP server, so coding agents get MeTTa intelligence as a tool: go to
definition, find references, hover, document and workspace symbols, go to implementation, and the call
hierarchy, through one `lsp` tool with an `operation` discriminator. It is the stdio process
`node dist/mcp/server.js`, and it takes its workspace from the client's working directory.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## One command

```bash
npm run setup:mcp              # print the config for every client
npm run setup:mcp -- --claude  # register with Claude Code (claude mcp add, user scope)
npm run setup:mcp -- --codex   # add it to ~/.codex/config.toml
npm run setup:mcp -- --all     # both
```

Applying is idempotent: an existing registration is left alone.

## OmegaClaw

OmegaClaw does not consume MCP client config. It exposes agent tools through its MeTTa `getSkills` catalogue.
Install the MeTTa-LSP OmegaClaw overlay into a user checkout instead:

```bash
npm run compile
npm run setup:omegaclaw -- /path/to/OmegaClaw-Core
```

The overlay is reversible:

```bash
npm run setup:omegaclaw -- /path/to/OmegaClaw-Core --uninstall
```

Current OmegaClaw upstream still uses a closed `getSkills` catalogue plus direct MeTTa equations for skills.
The overlay follows that contract with managed blocks and a receipt, so users can install it into their own
OmegaClaw system without forking OmegaClaw-Core.

## Or paste it yourself

### Claude Code

```bash
claude mcp add -s user metta-lsp -- node /path/to/metta-ts-lsp/dist/mcp/server.js
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers."metta-lsp"]
command = "node"
args = ["/path/to/metta-ts-lsp/dist/mcp/server.js"]
startup_timeout_sec = 120.0
```

### Generic MCP client (Claude Desktop, Cursor, an `mcp.json`)

```json
{
  "mcpServers": {
    "metta-lsp": {
      "command": "node",
      "args": ["/path/to/metta-ts-lsp/dist/mcp/server.js"]
    }
  }
}
```
