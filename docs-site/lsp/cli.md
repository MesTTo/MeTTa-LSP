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
| `list stdlib [--json]` | Lists the default library, labeled extensions, and builtin modules. |
| `inspect <name> [--json]` | Shows a builtin or module's signatures, docs, parameters, return value, and source. |
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
| `doc [workspace] [--json] [--build] [--serve] [--open] [--port N] [--base PATH] [--module-roots PATHS] [--host-roots PATHS]` | Generates or serves MeTTa docs for a workspace. |
| `repl [file]` | Starts an interactive MeTTa REPL, optionally seeded with a file. |
| `lsp --stdio` | Starts the language server over stdio. |
| `mcp --stdio` | Starts the MCP server over stdio. |

## Standard Library

List the MeTTa-LSP default-library catalog and every export from the builtin
modules supplied by the installed `@metta-ts/core` runtime. The global catalog
includes core builtins, MeTTa-LSP aliases, and bundled host-bridge symbols:

```bash
metta-lsp list stdlib
metta-lsp list stdlib --json
```

The text output separates core globals, MeTTa-LSP extensions, host bridge
extensions, and modules. Host bridge entries need the corresponding unguarded
Python or Prolog host even though they need no MeTTa import. Module entries show
the required `import!` form. JSON uses one `entries` array whose entries carry
`scope` and `category` fields, plus `modules` and `counts` fields. Entry records
include signatures, documentation fields, and source metadata.

Inspect one entry or a whole module:

```bash
metta-lsp inspect car-atom
metta-lsp inspect '+'
metta-lsp inspect json
metta-lsp inspect json::json-encode
```

Quote names that the shell treats as operators. Unqualified names work when
they identify one entry. Use `global::<name>` or `<module>::<name>` when the
same name occurs in more than one scope. An ambiguous inspection exits with
status 2 and prints the candidates. An unknown name exits with status 1 and
prints close matches. JSON errors are written to stderr.

The CLI does not enumerate third-party Hyperon packages or workspace modules.
Native Hyperon also supports `!(help!)`, `!(help! name)`, and `!(help! module)`
from MeTTa code. The official
[standard-library reference](https://trueagi-io.github.io/hyperon-experimental/metta/)
documents the native runtime.

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
metta-lsp search examples/09-formatting.metta '(if True $T $E)'
metta-lsp replace examples/09-formatting.metta '(if True $T $E)' '$T'
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

Write portable runtime documentation with a structured `@doc` atom and a type
declaration:

```metta
(@doc square
  (@desc "Squares a number")
  (@params (
    (@param "Number to square")))
  (@return "Squared number"))
(: square (-> Number Number))
(= (square $x) (* $x $x))
```

The type declaration supplies the parameter and return types that `get-doc`
adds to its normalized result. Do not write `@doc-formal` yourself.

For local editor and generated-site docs, contiguous `;;` lines directly above
a declaration or definition are a shorter alternative:

```metta
;; Squares a number.
;; The result has the same type as the input.
(: square (-> Number Number))
(= (square $x) (* $x $x))
```

A blank line or ordinary single-semicolon comment ends the doc block.
Structured `@doc` takes precedence when both forms exist.

Generate the MeTTa API reference for a workspace:

```bash
metta-lsp doc examples --json
```

The command always regenerates `docs-site/reference/metta/` and the generated
sidebar before printing JSON, building, or serving. Relative workspace,
module, and host roots resolve from the MeTTa-LSP checkout root.

Build or serve the docs site from the CLI:

```bash
metta-lsp doc examples --build
metta-lsp doc examples --serve --open --port 5173
```

Run the repository scripts from the MeTTa-LSP checkout root:

```bash
npm run docs:builtins
npm run docs:metta
```

`docs:builtins` rebuilds the builtin reference from the installed runtime
catalog and `get-doc`. `docs:metta` scans `examples` by default. Set
`METTA_DOCS_ROOTS` and `METTA_DOCS_HOST_ROOTS` to use other MeTTa and TypeScript
roots. The CLI accepts the same roots with `--module-roots` and `--host-roots`.

See the official [MeTTa learning guide](https://metta-lang.dev/docs/learn/learn.html),
[working with spaces](https://metta-lang.dev/docs/learn/tutorials/stdlib_overview/working_with_spaces.html),
[corelib reference](https://trueagi-io.github.io/hyperon-experimental/generated/corelib/),
and [module developer guide](https://trueagi-io.github.io/hyperon-experimental/modules_dev/).

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
