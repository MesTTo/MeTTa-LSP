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

The Claude Code and Codex modes also install the complete `skills/metta-lsp`
directory, including `agents/openai.yaml`. Set `CLAUDE_CONFIG_DIR` or
`CODEX_HOME` to install into a non-default agent root.

## OmegaClaw

OmegaClaw does not consume MCP client config. Install the MeTTa-LSP integration
into a checkout that has the [Python plugin API](https://github.com/asi-alliance/OmegaClaw-Core/commit/4a1439ce2e8b7bf55eb2fdbbfa0566fd0c8be6c5):

```bash
npm run compile
npm run setup:omegaclaw -- /path/to/OmegaClaw-Core
```

The installer adds a managed `metta_lsp` entry to `config/plugins.yaml`. Its
`location` points at `omegaclaw/plugin` in this MeTTa-LSP checkout. OmegaClaw's
Python loader imports `metta_lsp.py`, retains it in the plugin registry, and
calls `loadOmegaClawPlugin()`. Build MeTTa-LSP before starting OmegaClaw, and
rerun the installer if you move the MeTTa-LSP checkout.

The plugin API currently registers communication channels and LLM providers.
It has no skill-registration callback, and the MeTTa plugin loader is not
implemented. The installer therefore keeps a small managed MeTTa layer:

- It copies `src/skills_metta_lsp.metta` into the OmegaClaw checkout.
- It adds one managed import to `lib_omegaclaw.metta`.
- It advertises the wrappers through the existing `getSkills` catalogue.

Use `--skill-registry` to convert the closed catalogue to `skill-doc` equations
before registering the wrappers. The default mode leaves OmegaClaw's catalogue
shape intact. Both modes are idempotent and write a receipt.

The integration is reversible:

```bash
npm run setup:omegaclaw -- /path/to/OmegaClaw-Core --uninstall
```

The Python bridge remains external. Uninstall removes the plugin record, copied
wrapper, managed imports, catalogue entries, backups, and receipt.

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
