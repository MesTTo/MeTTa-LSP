# Suppressing diagnostics

Sometimes a diagnostic is a false alarm, or a warning you have decided to live
with. You can silence any diagnostic, and the language server never hides one
silently: you can always see what a suppression is doing.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Inline, one place at a time

Put a `; @suppress <code>` comment on the line above a diagnostic, or at the end
of its own line. It silences that code on both the comment's line and the next.

```metta
; @suppress symbol.possibleTypo
!(cdr-atomm 1)

!(car-atomm 2) ; @suppress symbol.possibleTypo
```

`; @suppress-file <code>` silences a code for the whole file; a bare
`; @suppress-file` silences everything. A code-less `; @suppress` silences every
code on the covered lines.

Every diagnostic also offers a **Suppress `<code>` on this line** quick-fix (the
lightbulb) that inserts the comment for you.

## Code as data, across a whole project

A `lint.metta` can carry a suppression written as a MeTTa pattern:

```metta
; Silence symbol.possibleTypo on anything inside a (legacy …) call:
(suppress (legacy $$$) symbol.possibleTypo)

; Silence every code inside an (experimental …) block:
(suppress (experimental $$$))
```

The pattern is matched structurally, exactly like a lint rule, so the
suppression is data, not a function that runs. List codes after the pattern to
narrow it, or leave them off to cover every code. This is more robust than
line-based suppression: it follows the code as you move it.

## Never silent

A suppression you cannot see is a trap. So:

- **Hover** a `; @suppress` directive to see the diagnostics it is silencing,
  with their messages, or a note that it is silencing nothing and is unused.
- **From the command line**, `metta-lsp check <file> --show-suppressed` lists
  every silenced diagnostic and the exact directive or rule that hid it.

```bash
metta-lsp check app.metta --show-suppressed
```

## What can be suppressed

Everything: the core diagnostics (undefined symbols, arity, type mismatches,
imports, …), the semantic-lint rules, the host-bridge checks, and the syntactic
lint rules. See the [diagnostics catalogue](../diagnostics/) for the codes.
