# MeTTa TS LSP — a tour by example

Open this folder in VS Code (with the MeTTa TS LSP extension installed) and walk
the files in order. Each one is short, heavily commented, and shows one part of
the language server. Where a feature is interactive, the comment tells you what
to click or press.

Start the server by opening any `.metta` file. For the Python examples you need
`python3` on your PATH.

For a capability-by-capability checklist, see
[`FEATURE-COVERAGE.md`](FEATURE-COVERAGE.md).

## The files

| File | What it shows | How to see it |
| --- | --- | --- |
| [`01-hovers.metta`](01-hovers.metta) | Rust-analyzer-style hovers | Hover a symbol (or press `K`) |
| [`02-running.metta`](02-running.metta) | Running, tracing, and visualising | Click **▶ Run** or **↝ Trace**; run **MeTTa: Visualise** |
| [`03-python.metta`](03-python.metta) | Python interop | Click **▶ Run** (unguarded) |
| [`04-diagnostics.metta`](04-diagnostics.metta) | The diagnostics catalogue | Read the squiggles; hover a code |
| [`05-lint-and-suppression/`](05-lint-and-suppression/demo.metta) | Lint rules and suppression | The lightbulb; hover a `; @suppress` |
| [`06-type-suggestions.metta`](06-type-suggestions.metta) | Add-type-declaration lightbulb | Cursor on a def → lightbulb |
| [`07-pseudocode.metta`](07-pseudocode.metta) | Pseudocode (mixfix) mode | Toggle `metta.pseudocode.enabled` |
| [`08-navigation.metta`](08-navigation.metta) | Definition, references, rename, call hierarchy | `F12`, `Shift+F12`, `F2` |
| [`09-formatting.metta`](09-formatting.metta) | The formatter | **Format Document** |
| [`10-testing.metta`](10-testing.metta) | `assert…` tests + Test Explorer | Test Explorer ▶; `metta-lsp test` |
| [`11-modules/`](11-modules/main.metta) | Cross-file imports and navigation | F12 across files; **▶ Run** |
| [`12-completion-and-hints.metta`](12-completion-and-hints.metta) | Completion, signature help, inlay hints | `Ctrl+Space`; toggle inlay hints |
| [`13-trace.metta`](13-trace.metta) | Step-by-step reduction trace | Click **↝ Trace**; `metta-lsp trace <file> "<query>"` |
| [`14-editor-surfaces.metta`](14-editor-surfaces.metta) | Semantic colours, symbols, type navigation, links, folding, linked editing, selection ranges | Outline, F12, linked edit, Expand Selection |
| [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta) | Guarded evaluation, status commands, CLI, MCP | **MeTTa: Evaluate (Guarded Runtime)**; `metta-lsp capabilities` |
| [`16-debugging.metta`](16-debugging.metta) | Debug adapter stepping and breakpoints | Run and Debug → `MeTTa: reduce query` |
| [`17-prolog-diagnostics/`](17-prolog-diagnostics/main.metta) | Read-only Prolog parser diagnostics for `.pl` bridge files | Open `main.metta` with `swipl` on PATH |
| [`18-host-bridge/`](18-host-bridge/main.metta) | TypeScript grounded-operation host bridge | Open `examples/` as the workspace; hover or F12 on `my-max` |
| [`19-typescript-plugin/`](19-typescript-plugin/sample.ts) | MeTTa intelligence inside TypeScript strings and templates | Open `sample.ts`; use workspace TypeScript |

## Diagnostics and suppression

`04-diagnostics.metta` triggers every code in the catalogue on purpose. Each is
underlined; hover it for the message, and click the code for the page that
explains the fix.

`05-lint-and-suppression/` has its own `lint.metta`, discovered by walking up
from the file the way ESLint and Prettier cascade their config. It turns on a
built-in rule, adds a project rule with an autofix, and declares a code-as-data
`(suppress (legacy $$$) symbol.possibleTypo)` — a suppression written as a MeTTa
pattern, matched structurally like a lint rule. Any diagnostic is also
suppressible inline with `; @suppress <code>` on the line above it.

Suppression is never silent. Hover a `; @suppress` directive to see exactly what
it hides (or that it hides nothing and is unused), or from the command line:

```bash
metta-lsp check 05-lint-and-suppression/demo.metta --show-suppressed
```

## Beyond the editor

The same engine is a library, a CLI, and an MCP server for coding agents. See
the docs' [Ergonomic DSL](../docs-site/lsp/dsl.md) and
[Agent setup (MCP)](../docs-site/lsp/mcp.md) pages.

`15-guarded-and-agent-surfaces.metta` is the quickest local smoke file for the
shared engine. It points to the matching CLI and MCP commands, including the
checked `examples/mcp-smoke.jsonl` and `examples/mcp-tool-smoke.jsonl` request
streams.

MeTTa reaches across languages too. In a `.ts` file, the
[`metta-ts-typescript-plugin`](../typescript-plugin/README.md) gives the same
hovers, completions, and diagnostics inside a `db.q("…")` MeTTa string (see the
[eDSL overview](../docs-site/edsl/overview.md)). Going the other way, in a
`.metta` file the LSP resolves a grounded atom to the TypeScript host type it
binds to, on hover or via `metta-lsp host-type <file> <line> <col>`.

For that host bridge example, open `examples/` itself as the VS Code workspace.
The local [`tsconfig.json`](tsconfig.json) indexes
[`18-host-bridge/host.ts`](18-host-bridge/host.ts), so
[`18-host-bridge/main.metta`](18-host-bridge/main.metta) can resolve `my-max`
back to the TypeScript function that registered it.

The same [`tsconfig.json`](tsconfig.json) also enables the TypeScript language
service plugin for [`19-typescript-plugin/sample.ts`](19-typescript-plugin/sample.ts).
In VS Code, run **TypeScript: Select TypeScript Version** and choose the
workspace version if template diagnostics do not appear.
