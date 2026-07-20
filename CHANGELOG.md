# Changelog

## 0.16.0 - 2026-07-20

- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, Prolog,
  libraries, and debugger packages to 1.5.0, picking up the unified `metta`
  CLI from 1.4.0 and the 1.5.0 engine work: anchored-conjunction routing, the
  ordered numeric range index, the direct top-level match, the compact static
  fact base, and the trail-served compiled search. All engine paths are on by
  default and byte-identical to the reference evaluator, so guarded evaluation,
  diagnostics, hover, and the debugger behave as before, faster on large fact
  bases. The generated builtin reference is unchanged (no new builtins).

## 0.15.1 - 2026-07-19

- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, Prolog,
  libraries, and debugger packages to 1.3.1.
- Keep valid one-string `(@return "...")` documentation forms from producing a
  `call.arity` warning.
- Make the MCP edit tools write their edits to workspace files. Formatting,
  range formatting, import organization, rename, and selected code actions now
  return both the edit payload and an `applied` summary.

## 0.15.0 - 2026-07-19

- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, Prolog,
  libraries, and debugger packages to 1.3.0. Register `@metta-ts/libraries`
  before reading `builtinModules()`, so the extracted `vector`, `roman`,
  `combinatorics`, `patrick`, `datastructures`, `spaces`, `nars`, and `pln`
  modules remain visible in diagnostics, hover, completion, CLI stdlib
  inspection, and generated builtin docs.
- Add the `MeTTa: Why Did This Reduce?` command backed by `@metta-ts/debug`.
  It explains the runnable form under the cursor, or the file's last query, with
  result atoms, grounded reducer counts, higher-order specialization, overflow
  cut points, and reduction count.
- Add a DAP `Trace` scope populated from the real engine trace while keeping the
  grapher-based expression stepping. Continue now stops with a clear stack
  overflow cut-point when the engine reports one.

## 0.14.0 - 2026-07-19

- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, and Prolog
  packages to 1.2.0. The 1.2.0 runtime adds importable `vector`, `roman`,
  `combinatorics`, `patrick`, `datastructures`, `spaces`, `nars`, and `pln`
  libraries, linear grounded list operations (`size-atom`, `map-atom`,
  `filter-atom`, and `foldl-atom`), an engine trace bus, and the `metta-debug`
  CLI.

## 0.13.0 - 2026-07-18

- Add `metta-lsp list stdlib` and `metta-lsp inspect` for the MeTTa-LSP default
  library and installed builtin modules, with qualified names, structured JSON,
  ambiguity errors, suggestions, and broken-pipe handling.
- Expand the shipped MeTTa-LSP skill with CLI, stdlib, official MeTTa docs,
  structured `@doc` syntax, local doc comments, and exact docs commands. Install
  the complete skill for Claude Code and Codex.
- Load the OmegaClaw Python bridge through the plugin API and
  `loadOmegaClawPlugin()`. Keep only the MeTTa wrapper and skill catalogue as a
  managed overlay because upstream does not expose skill registration.
- Treat a running `import!` target as the space token it declares, so
  `!(import! &schema module)` no longer reports `space.unbound`.
- Interpret the positional argument to `metta-lsp doc` as its workspace root
  while locating `docs-site` from the MeTTa-LSP checkout.
- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, and Prolog
  packages to 1.1.7. The 1.1.7 core resolves grounded substitution to a fixpoint,
  fixing a unification soundness bug where a single-pass substitution could return
  a spurious extra proof, so guarded MeTTa evaluation inherits the fix. The 1.1.6
  core adds structural inequality `!=` with type `(-> $t $t Bool)`, matching the
  type the language server already reports for it.

## 0.12.0 - 2026-07-15

- Add a browser-hosted multi-file MeTTa IDE with live LSP diagnostics, completion, hover, navigation,
  rename, formatting, symbols, semantic tokens, workspace persistence, and guarded evaluation.
- Cancel obsolete browser requests and evaluation workers after edits, file switches, restarts, and page
  teardown. Persist the final editor state when the page is hidden or unloaded.
- Open browser workspaces through one indexed startup pass, avoid duplicate open diagnostics, and version all
  nested worker assets from one content hash so a deployment cannot mix worker releases.
- Add browser IDE keyboard tab navigation, named editor input, reduced-motion behavior, narrow-screen command
  access, readable contrast, and storage-failure reporting.
- Ship the TypeScript language-service plugin at the path tsserver resolves it from. `npm install` packs the
  plugin into `node_modules` as a real directory instead of a symlink vsce cannot package, the build mirrors
  the bundle into it, and the VSIX check now requires it, so a packaged extension cannot lose the plugin
  silently.
- Pin the documentation toolchain to a patched esbuild release while VitePress remains on its stable line.
- Pan the visualise canvas by dragging it. The canvas owns its whole panel, so a left-drag on empty space
  now moves the picture instead of rubber-band selecting; shift-drag still rubber-bands.
- Update the MeTTa TS runtime, browser, graph, Hyperon, Node, Python, and Prolog packages to 1.1.5.
- Refresh cached import resolution when workspace files are created, deleted, or renamed.
- Register configuration-change notifications only when the LSP client advertises dynamic registration.
- Add an editor-neutral Emacs major mode with static MeTTa font-lock and setup for Eglot and lsp-mode.

## 0.11.1 - 2026-07-09

First public release candidate for MeTTa LSP.

- VS Code language support for `.metta` files, including syntax highlighting, semantic tokens, snippets,
  diagnostics, hovers, completions, formatting, rename, references, definitions, code actions, inlay hints,
  folding, document symbols, workspace symbols, and call hierarchy.
- Guarded MeTTa evaluation with fuel, timeout, stack, source, result, and captured-output limits.
- Run, trace, visualise, test, lint, search, replace, docs, REPL, stdio LSP, and stdio MCP command-line
  surfaces through `metta-lsp`.
- MCP tools for Claude Code, Codex, and other clients, with compact symbol, location, and call-hierarchy
  responses by default.
- Generated MeTTa docs, builtins reference, diagnostic pages, suppression examples, and editor setup docs.
- TypeScript host bridge, Python interop examples, Prolog diagnostics for referenced bridge files, and
  browser/docs playground surfaces.
