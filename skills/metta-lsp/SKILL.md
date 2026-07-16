---
name: metta-lsp
description: Use for reading, navigating, checking, formatting, documenting, or running MeTTa (.metta) code, and for listing or inspecting the installed MeTTa standard library. Prefer the MeTTa-LSP MCP tools or CLI over text search when definitions, references, types, diagnostics, runtime documentation, or generated API docs matter.
---

# MeTTa language intelligence

Use MeTTa-LSP for `.metta` code. Its navigation, diagnostics, types, and docs
come from the analyzer and the installed `@metta-ts/core` runtime. Use exact
text search only after language-aware navigation has identified the relevant
symbols or files.

There are two interfaces:

- Use the `lsp_*` MCP tools when the MeTTa-LSP MCP server is available.
- Use `metta-lsp <command>` in a shell for scripts, CI, and stdlib discovery.

## Navigate and understand code

MCP positions use 1-based `line` and `character` values.

- Use `lsp_definition`, `lsp_declaration`, and `lsp_type_definition` to find a
  symbol, declaration, or type. Builtins resolve to virtual stdlib sources.
- Use `lsp_references` for scope-aware references across imports. Do not replace
  it with grep.
- Use `lsp_implementation` for the `=` equations that implement a function.
- Use `lsp_call_hierarchy` to inspect incoming and outgoing calls.
- Use `lsp_document_symbols` or `lsp_workspace_symbols` to map a file or
  workspace.
- Use `lsp_hover` for the interpreter type and documentation at a position.
- Use `lsp_signature_help`, `lsp_inlay_hints`, and `lsp_explain` for call
  signatures, inferred types, and a plain explanation of a form.
- Use `lsp_reduce_trace` to follow reductions and variable bindings.
- Use `lsp_host_type` for the TypeScript binding behind a grounded atom.

Use `lsp_diagnostics` before running code. It reports parser, type, arity,
import, and space diagnostics without executing the file. Use `lsp_lint` for
structural lint findings and `lsp_run_tests` for `assert*` forms.

Editing and execution tools include `lsp_format`, `lsp_format_range`,
`lsp_organize_imports`, `lsp_rename`, `lsp_code_actions`, `lsp_evaluate`, and
`lsp_guarded_evaluate`. Prefer guarded evaluation for code you do not trust.

The `lsp` tool dispatches the common navigation operations when one entry point
is easier for the client.

## Use the CLI

Run `metta-lsp --help` for the installed command surface. Common commands are:

```bash
metta-lsp check path/to/file.metta --json
metta-lsp lint path/to/file.metta --fix
metta-lsp fmt path/to/file.metta --check
metta-lsp hover path/to/file.metta 12 8 --json
metta-lsp def path/to/file.metta 12 8 --json
metta-lsp refs path/to/file.metta 12 8 --json
metta-lsp symbols path/to/file.metta --json
metta-lsp test path/to/file.metta --tap
metta-lsp run path/to/file.metta
metta-lsp trace path/to/file.metta "(query)" --max 20
metta-lsp search path/to/file.metta '(pattern $X)' --json
metta-lsp replace path/to/file.metta '(old $X)' '(new $X)' --write
metta-lsp visualise path/to/file.metta "(query)" --out trace.html
metta-lsp repl path/to/file.metta
```

If the checkout is not linked and `metta-lsp` is not on `PATH`, run the same
commands through its npm script:

```bash
npm run compile
npm --silent run cli -- check path/to/file.metta --json
npm --silent run cli -- list stdlib --json
npm --silent run cli -- doc examples --serve --open --port 5173
```

Most read commands accept `--json`. Use JSON when another tool will consume the
result.

## Discover the installed standard library

`list stdlib` reads the same default-library catalog and runtime modules used by
hover and completion. The catalog includes core builtins, MeTTa-LSP aliases,
and bundled Python and Prolog bridge symbols. It also includes opt-in modules
reported by the installed `@metta-ts/core` runtime.

Text output separates core globals, MeTTa-LSP extensions, host bridge
extensions, and modules. Host bridge entries need the corresponding unguarded
Python or Prolog host even though they need no MeTTa import.

```bash
metta-lsp list stdlib
metta-lsp list stdlib --json
```

Inspect an entry for its scope, kind, type signatures, description, parameters,
return value, and source:

```bash
metta-lsp inspect car-atom
metta-lsp inspect '+'
metta-lsp inspect json
metta-lsp inspect json::json-encode
metta-lsp inspect global::+ --json
```

Quote shell operators such as `+`, `*`, `<`, and `>`. An unqualified name works
when it identifies one entry. If the name exists globally and in a module, use
`global::<name>` or `<module>::<name>`. Inspecting a module prints its import form
and exports.

For example, `transaction` exists in two scopes:

```bash
metta-lsp inspect transaction --json
metta-lsp inspect global::transaction --json
metta-lsp inspect concurrency::transaction --json
```

An ambiguous inspection writes a structured error to stderr and exits with
status 2. An unknown name exits with status 1 and includes suggestions. The
global `transaction` entry currently has no declared signature or docs, while
the module entry has a type.

JSON has one `entries` array with `scope` and `category` fields on each entry,
plus `modules` and `counts` fields. The list does not claim to enumerate
third-party Hyperon packages or workspace modules outside the default catalog.

Native Hyperon also exposes runtime help from MeTTa code:

```metta
!(help!)
!(help! some-function)
!(help! some-module)
```

Use `metta-lsp inspect` for this repository because it returns deterministic
text or JSON even when the current MeTTa TS host does not print `help!` output.

## Write MeTTa documentation

Use a structured `@doc` atom for documentation that should work with Hyperon as
well as MeTTa-LSP:

```metta
(@doc square
  (@desc "Squares a number")
  (@params (
    (@param "Number to square")))
  (@return "Squared number"))
(: square (-> Number Number))
(= (square $x) (* $x $x))
```

The type declaration supplies parameter and return types. Keep the number of
`@param` entries aligned with the function arguments. Do not author
`@doc-formal`; `get-doc` produces that normalized form.

MeTTa-LSP also accepts a local comment shorthand. Put contiguous `;;` lines
directly above the `:` declaration or `=` definition:

```metta
;; Squares a number.
;; The result has the same numeric type as the input.
(: square (-> Number Number))
(= (square $x) (* $x $x))
```

A blank line or an ordinary single-semicolon comment ends the doc block.
Annotation comments beginning with `; @doc`, `; @desc`, `; @param`, or
`; @return` are also recognized as adjacent local docs. Structured `@doc` wins
when both forms exist. Use the comment shorthand for editor and generated-site
docs only. Use structured atoms for portable runtime documentation.

## Generate documentation

Run the npm scripts from the MeTTa-LSP repository root:

```bash
npm run docs:builtins
npm run docs:metta
```

`docs:builtins` rebuilds `docs-site/reference/builtins.md` from the runtime
catalog and `get-doc`. `docs:metta` rebuilds the workspace API pages under
`docs-site/reference/metta/` from MeTTa definitions, structured docs, adjacent
doc comments, and TypeScript host operations.

The CLI accepts a workspace root while discovering `docs-site` from the current
MeTTa-LSP checkout:

```bash
metta-lsp doc examples --json
metta-lsp doc examples --build
metta-lsp doc examples --serve --open --port 5173
metta-lsp doc examples --module-roots examples,lib --host-roots src
```

Every `doc` invocation regenerates the committed API pages and generated
sidebar before it prints JSON, builds, or serves. Treat it as a write operation.
Relative workspace, module, and host roots resolve from the MeTTa-LSP checkout
root, even when the shell is in one of its subdirectories.

Set `METTA_DOCS_ROOTS` and `METTA_DOCS_HOST_ROOTS` when using `npm run
docs:metta` with roots other than `examples`.

## Documentation sources

- [MeTTa learning guide](https://metta-lang.dev/docs/learn/learn.html)
- [Working with spaces and imports](https://metta-lang.dev/docs/learn/tutorials/stdlib_overview/working_with_spaces.html)
- [Official standard-library reference](https://trueagi-io.github.io/hyperon-experimental/metta/)
- [Generated corelib reference](https://trueagi-io.github.io/hyperon-experimental/generated/corelib/)
- [Module developer guide](https://trueagi-io.github.io/hyperon-experimental/modules_dev/)
- [MeTTa-LSP builtin reference](https://mestto.github.io/MeTTa-LSP/reference/builtins)
- [MeTTa-LSP CLI reference](https://mestto.github.io/MeTTa-LSP/lsp/cli)
