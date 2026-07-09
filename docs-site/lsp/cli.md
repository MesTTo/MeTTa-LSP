# Command line

The `metta-lsp` command runs the same analyzer that powers the editor and MCP
server. Use it for scripts, CI, local checks, generated docs, and agent smoke
tests.

From this checkout, build first:

```bash
npm install
npm run compile
```

The installed command is `metta-lsp`:

```bash
metta-lsp check examples/04-diagnostics.metta
metta-lsp trace examples/13-trace.metta "(sum-to 3)"
```

From an unlinked checkout, use the npm alias:

```bash
npm --silent run cli -- check examples/04-diagnostics.metta
npm --silent run cli -- trace examples/13-trace.metta "(sum-to 3)"
```

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Commands

Most read commands accept `--json`, which is the best format for scripts and
agents.

| Command | What it does |
| --- | --- |
| `capabilities` | Prints the capability ledger and surface coverage. |
| `check <file> [--json] [--show-suppressed]` | Runs parser, analyzer, lint, bridge, and optional diagnostics. |
| `symbols <file> [--json]` | Prints the document outline. |
| `hover <file> <line> <character> [--json]` | Shows hover text at a 1-based editor position. |
| `def <file> <line> <character> [--json]` | Goes to the symbol definition. |
| `host-type <file> <line> <character> [--json]` | Shows TypeScript host signature data for a grounded atom. |
| `explain <file> <line> <character> [--json]` | Renders the current form as mixfix notation. |
| `refs <file> <line> <character> [--json]` | Finds references for the symbol at a position. |
| `fmt <file> [--check]` | Formats a MeTTa file or checks whether it is formatted. |
| `lint <file> [--json] [--fix]` | Runs syntactic lint rules and optionally applies fixes. |
| `search <file> "<pattern>" [--json]` | Runs the structural pattern matcher. |
| `replace <file> "<pattern>" "<template>" [--write]` | Previews or applies structural rewrites. |
| `test <file> [--json] [--tap] [--junit]` | Runs top-level assert forms under the guarded runtime. |
| `run <file> [--unguarded]` | Evaluates top-level bang queries. Use `--unguarded` only for trusted host interop. |
| `trace <file> "<query>" [--json] [--max N]` | Shows each reduction step for a query. |
| `visualise <file> "<query>" [--out file.html] [--block]` | Writes a reduction graph HTML view. |
| `doc [root] [--json] [--build] [--serve] [--open] [--port N] [--base PATH]` | Generates or serves MeTTa docs for a workspace. |
| `repl [file]` | Starts an interactive MeTTa REPL, optionally seeded with a file. |
| `lsp --stdio` | Starts the language server over stdio. |
| `mcp --stdio` | Starts the MCP server over stdio. |

## Diagnostics and Suppression

Run the full checker:

```bash
metta-lsp check examples/04-diagnostics.metta
```

Show diagnostics hidden by inline `; @suppress` comments or `lint.metta`
suppression rules:

```bash
metta-lsp check examples/05-lint-and-suppression/demo.metta --show-suppressed
```

Use JSON when a tool needs exact ranges and diagnostic codes:

```bash
metta-lsp check examples/04-diagnostics.metta --json
```

## Search and Rewrite

The structural matcher treats MeTTa forms as data. `$X` captures one atom and
`$$$Rest` captures a sequence.

```bash
metta-lsp search examples/09-formatting.metta "(if True $T $E)"
metta-lsp replace examples/09-formatting.metta "(if True $T $E)" "$T"
```

Add `--write` only when you want to update the file.

## Trace and Visualise

Trace a reduction:

```bash
metta-lsp trace examples/13-trace.metta "(sum-to 3)" --max 8
```

Write an interactive graph view:

```bash
metta-lsp visualise examples/13-trace.metta "(sum-to 3)" --out trace.html
```

## Generated Docs

Generate the MeTTa API reference:

```bash
metta-lsp doc examples --json
```

Build or serve the docs site from the CLI:

```bash
metta-lsp doc examples --build
metta-lsp doc examples --serve --open --port 5173
```

The npm scripts call the same docs pipeline:

```bash
npm run docs:builtins
npm run docs:metta
```

## LSP and MCP

Use stdio for editors and clients that launch the server themselves:

```bash
metta-lsp lsp --stdio
```

Use stdio MCP for clients that expect a tool server:

```bash
metta-lsp mcp --stdio
```

For Claude Code, Codex, and generic MCP clients, the setup helper writes or
prints the client config:

```bash
npm run setup:mcp -- --claude --codex
```
