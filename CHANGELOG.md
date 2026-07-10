# Changelog

## Unreleased

- Refresh cached import resolution when workspace files are created, deleted, or renamed.

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
