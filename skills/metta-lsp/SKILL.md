---
name: metta-lsp
description: Use when reading, navigating, reviewing, checking, formatting, or running MeTTa (.metta) code. Reach for metta-lsp's interpreter-backed intelligence (the lsp_* MCP tools, or the metta-lsp CLI) instead of raw grep and read, so navigation, types, and diagnostics come from the real interpreter rather than guesswork.
---

# metta-lsp: language intelligence for MeTTa

metta-lsp understands MeTTa the way a compiler does. Its types, definitions, and
diagnostics come from the real @metta-ts interpreter, not text heuristics, so its
answers match what the code actually does. When you work with `.metta` files,
prefer it over grep and manual reading.

There are two front doors to the same intelligence: the MCP tools (`lsp_*`), if
the server is configured for your agent, and the `metta-lsp` CLI in a terminal.

## When to use it

- To find where a symbol is defined, or every place it is used across files, use
  definition and references, not grep.
- To learn what a symbol is, use hover: it reports the interpreter's own type and
  documentation.
- To check whether code is correct before running it, use diagnostics (the
  interpreter's type and arity verdicts) and lint.
- To see how an expression reduces and what each variable binds to, use the
  reduction trace.
- To format, rename, or organize imports, use the formatter and rename.
- To run a file or its tests, use evaluate and run-tests.

## MCP tools

With the `metta-lsp` MCP server configured, these are available. Pass a
`filePath`, and where a position is needed, a 1-based `line` and `character`.

Navigate the code:

- `lsp_definition`, `lsp_declaration`, `lsp_type_definition`: where a symbol, its
  declaration, or its type is defined. Builtins resolve into the stdlib source.
- `lsp_references`: every use of a symbol, workspace-wide, resolving imports and
  scope.
- `lsp_implementation`: the `=` equations that implement a function.
- `lsp_call_hierarchy`: who calls this and what it calls.
- `lsp_document_symbols`, `lsp_workspace_symbols`: the outline of a file or the
  whole workspace.

Understand a symbol:

- `lsp_hover`: its interpreter type and `@doc`.
- `lsp_host_type`: for a grounded atom, the TypeScript host type it binds to.
- `lsp_reduce_trace`: the step-by-step reduction of a query, showing what each
  variable binds to.
- `lsp_signature_help`, `lsp_inlay_hints`, `lsp_explain`: call signatures,
  inferred types, and a plain reading of a form.

Check correctness:

- `lsp_diagnostics`: the interpreter's type and arity errors. BadArgType names the
  offending argument with expected vs actual type; IncorrectNumberOfArguments
  names the expected count.
- `lsp_lint`: structural lint findings from the metta-semgrep rules.
- `lsp_run_tests`: run the file's `assert*` tests.

Edit and run:

- `lsp_format`, `lsp_format_range`, `lsp_organize_imports`, `lsp_rename`,
  `lsp_code_actions`.
- `lsp_evaluate` runs the file's queries fuel-bounded; `lsp_guarded_evaluate`
  runs untrusted code under a hard kill.

`lsp` is a single dispatcher over the navigation operations if you prefer one
entry point over the individual tools.

## CLI

In a terminal, `metta-lsp <command>` gives the same intelligence:

    metta-lsp check <file>                 # type + arity + lint diagnostics
    metta-lsp lint <file> [--fix]          # structural lint, optionally autofix
    metta-lsp fmt <file> [--check]         # format, or check formatting
    metta-lsp run <file>                   # evaluate the bang queries
    metta-lsp trace <file> "<query>"       # reduction trace of a query
    metta-lsp hover <file> <line> <col>    # type + docs at a position
    metta-lsp def <file> <line> <col>      # go to definition
    metta-lsp refs <file> <line> <col>     # find references
    metta-lsp symbols <file>               # document symbols
    metta-lsp test <file> [--tap|--junit]  # run assert* tests
    metta-lsp search <file> "<pattern>"    # structural (semgrep) search
    metta-lsp replace <file> "<pat>" "<tmpl>" [--write]  # structural rewrite
    metta-lsp visualise <file> "<query>"   # render the reduction as HTML
    metta-lsp repl [file]                  # interactive REPL

Most commands take `--json` for machine-readable output. `metta-lsp --help`
prints this list.

## Why prefer it

A grep for a symbol finds text; `lsp_references` finds the real uses, across
imports and scope. A guessed type is a guess; `lsp_hover` and `lsp_diagnostics`
return the interpreter's own answer. When the question is "is this call
well-typed" or "where does this come from", the LSP settles it instead of you
inferring it.
