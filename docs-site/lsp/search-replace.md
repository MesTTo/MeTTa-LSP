# Structural search and replace

Find and rewrite MeTTa by structure, not by text. You write a pattern as an
ordinary MeTTa term; it matches wherever a form has that shape, whatever the
whitespace or the names bound to the capture variables. It is the same idea as
`; @suppress (suppress <pattern> …)` and the lint rules: code as data, matched
by the structural engine, never evaluated.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Patterns

A pattern is one well-formed form. Inside it:

- `$X`, `$Name` (leading capital) captures one subterm, and reappears in the
  replacement. Repeating `$X` requires the same subterm both times.
- `$$$` matches a run of arguments; `$$$rest` captures it for the replacement.
- `$_` matches anything without capturing.
- Everything else, a symbol, number, or string, matches itself.

## From the command line

```bash
# Every (if True …) in a file, with its location:
metta-lsp search app.metta "(if True $T $E)"

# Rewrite each to its then-branch (prints the result; add --write to apply):
metta-lsp replace app.metta "(if True $T $E)" "$T"

# Rename a call across a file, keeping its arguments:
metta-lsp replace app.metta "(old-api $$$args)" "(new-api $$$args)" --write
```

`search` also takes `--json` for tooling. `replace` prints the rewritten source
by default and only touches the file with `--write`.

## Programmatically

```ts
import { search, replace } from "metta-ts-lsp/dsl";

search(source, "(if True $T $E)");        // → the matches, with offsets
replace(source, "(foo $X)", "(bar $X)");  // → the rewritten source string
```

Overlapping matches (a pattern that hits a form and a form nested inside it) are
applied non-overlapping and right-to-left, so no rewrite lands inside another.
