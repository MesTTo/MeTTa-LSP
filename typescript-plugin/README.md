<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: Apache-2.0
-->

# metta-ts-typescript-plugin

MeTTa language intelligence inside the TypeScript you already write. When you build MeTTa with [`@metta-ts/edsl`](https://www.npmjs.com/package/@metta-ts/edsl)'s `m` and `mAll` tagged templates, this plugin makes the MeTTa inside them a first-class language: diagnostics, completion, hover, signature help, go-to-definition, find-references, outlining, and quick-fixes, right there in the template.

It runs inside the TypeScript language server, so it works in any editor that drives `tsserver`, not only VS Code.

## What you get

Take a `.ts` file that writes MeTTa through the eDSL:

```ts
import { mettaDB, m } from "@metta-ts/edsl";

const db = mettaDB();
db.add(m`(= (double $x) (unkown-atom $x))`);
//                        ^^^^^^^^^^^ squiggled: unknown atom 'unkown-atom' — did you mean 'unknown-atom'?
```

Inside the `` m`…` `` template you now get the same help you would in a `.metta` file: the misspelled atom is flagged with a did-you-mean fix, `double` completes, hovering a symbol shows its type, and the outline lists the rule. The `${...}` holes are treated as values, so interpolating a TypeScript expression never produces a false MeTTa error.

## Install

```bash
npm install --save-dev metta-ts-typescript-plugin
```

The plugin is self-contained: its only peer dependency is the `typescript` your project already uses.

## Setup

### Any editor: add it to `tsconfig.json`

This is the universal path. Add the plugin to your `tsconfig.json` and every editor that uses the TypeScript language server picks it up:

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "metta-ts-typescript-plugin" }]
  }
}
```

Because the plugin lives inside `tsserver`, it applies wherever `tsserver` runs. A few editors need one extra step to run the plugin from your workspace rather than their own bundled TypeScript:

- **VS Code** — run the command `TypeScript: Select TypeScript Version` and pick **Use Workspace Version**. (Or skip the `tsconfig` step entirely and use the auto-load below.)
- **Neovim** — works out of the box with `coc-tsserver` or `typescript-language-server` (`nvim-lspconfig`); the server reads your `tsconfig` `plugins`.
- **Sublime Text** — `LSP-typescript` reads the `tsconfig` `plugins` automatically.
- **Emacs** — `eglot` or `lsp-mode` with `typescript-language-server` picks it up from `tsconfig`.
- **JetBrains (WebStorm, IntelliJ)** — enable the TypeScript Language Service; it honors `tsconfig` `plugins`.

### VS Code: automatic, no `tsconfig` edit

If you install the companion VS Code extension, it contributes the plugin to VS Code's built-in TypeScript server for you, so MeTTa templates light up without touching `tsconfig`. This is a convenience layer only; the `tsconfig` path above is what makes it portable across editors.

## What lights up

Everything the plugin serves comes from the same MeTTa language service the standalone MeTTa LSP uses, so the behavior matches a real `.metta` file:

- **Diagnostics** — undefined atoms, arity mismatches, and the rest, mapped to the exact spot in your `.ts` file.
- **Did-you-mean and quick-fixes** — a misspelled symbol offers the correction; structural fixes edit the template in place.
- **Completion** — workspace definitions and builtins, filtered by what you have typed.
- **Hover and signature help** — types and documentation for the symbol under the cursor.
- **Go-to-definition, definition preview, and find-references** — navigate a symbol across the template.
- **Outline** — the template's definitions in the editor's symbol tree.

## How it works

The plugin builds on Microsoft's [`typescript-template-language-service-decorator`](https://github.com/microsoft/typescript-template-language-service-decorator), the same engine behind `typescript-styled-plugin`. The decorator finds the `m`/`mAll` tagged templates, replaces each `${...}` interpolation with an equal-length placeholder, and maps positions between the template body and your file. The plugin runs the MeTTa language service over that body and translates the results back into the shapes `tsserver` expects, which the decorator repositions into your `.ts` file. The placeholder for an interpolation reads as a MeTTa variable, so a hole where you drop a TypeScript value is never mistaken for an undefined atom.

## License

Apache-2.0
