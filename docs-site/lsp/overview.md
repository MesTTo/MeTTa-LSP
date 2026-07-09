# The MeTTa language server

MeTTa LSP is a TypeScript language server and VS Code extension for MeTTa. It reads
your code the way the interpreter does and turns that understanding into editor features: hovers, go to
definition, references, rename, completions, diagnostics, formatting, running, and visualising a reduction.

Runtime behavior comes from MeTTa TS. The LSP docs describe editor, [CLI](./cli), MCP, diagnostics, and generated
reference pages; for the runtime packages, TypeScript APIs, async host operations, and browser runner, see
the [MeTTa TS documentation](https://mestto.github.io/Meta-TypeScript-Talk/).

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## What you get

- **Rich hovers** in the rust-analyzer style: a symbol's signature, its interpreter-exact type, where it
  is defined, and a link straight to its [builtins reference](/reference/builtins) entry.
- **Run** without the guard caps from the ▶ button or the run code lens. A run evaluates the whole file
  (or one bang query), and the results print to the MeTTa Run output channel in MeTTa syntax. Fuel and
  timeout are configurable; MeTTa's own `pragma!` governs the rest.
- **Visualise** the reduction as the interactive MeTTaGrapher, the same component this site embeds: step
  through it, switch between the graph and block views, and export the animation as a GIF.
- **Python interop**: when a program uses the [`py-atom`](/reference/builtins#py-atom) family or
  `py-call`/`py-eval`, an unguarded run evaluates them against real CPython. Guarded evaluation never
  loads the bridge, so py atoms stay inert there by construction.
- **Diagnostics** with a full [catalogue](/diagnostics/): every code links to a page explaining what it
  means and how to fix it, so you always see the whole message, not just the one line in the editor.
- **Suggestions**: a lightbulb offers to add a type declaration to an untyped function, because a declared
  type lets the interpreter dispatch by type instead of trying every rule.
- **Pseudocode mode**: a toggle that shows each top-level form's [mixfix reading](/lsp/mixfix) above it.

## Settings

The status-bar button (or the command **MeTTa: Settings**) opens a quick-pick that toggles the common
settings without leaving the editor: inlay hints, pseudocode mode, and the diagnostic groups. They are
ordinary VS Code settings, so they also live in the Settings UI and sync across your machines.

`metta.docs.baseUrl` points the hover and diagnostic docs links at wherever this site is deployed. Set it
to your deployment's URL and every "Open docs" link and diagnostic code resolves here.
