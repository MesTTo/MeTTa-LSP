# Semantic refactoring

MeTTa-LSP can find repeated MeTTa terms and simplify executable expressions.
Both features use the interpreter's atom model. They do not treat source text as
the meaning of a program.

## Find semantic clones

Run `deduplicate` on files or directories:

```bash
metta-lsp deduplicate src tests
metta-lsp deduplicate . --json --min-atoms 12 --threshold 5
```

The detector parses every `.metta` file and groups expression atoms with
MeTTa's alpha-equivalence:

```metta
(= (twice $x) (+ $x $x))
(= (twice $value) (+ $value $value))
```

Those definitions are one alpha-equivalent clone. A repeated variable must
still repeat. `(same $x $x)` does not match `(same $a $b)`. Argument order,
grounded values, and expression shape also remain significant.

Each occurrence has one semantic role:

- `declaration`
- `data`
- `executable`
- `pattern`
- `quoted`
- `type`

Terms in different roles are not grouped. The detector also removes an inner
clone when every occurrence is already covered by a larger clone. An extra
standalone occurrence keeps the inner group in the report.

`--min-atoms` defaults to 8 and `--min-lines` defaults to 1. Use `--ignore`
more than once for multiple globs. Directory scans stop at 4,000 files and skip
files over 5 MiB by default. Override the limits with `--max-files` and
`--max-file-bytes`. Explicit files are always read.

The exit status is:

| Status | Meaning |
| --- | --- |
| `0` | The scan completed and stayed at or below `--threshold`, when set. |
| `1` | The duplicate atom percentage exceeded `--threshold`. |
| `2` | The scan was incomplete because of a read error, parse error, or scan limit. |

## Simplify an executable expression

Preview a file:

```bash
metta-lsp simplify program.metta
```

Show proof records or machine-readable output:

```bash
metta-lsp simplify program.metta --proof
metta-lsp simplify program.metta --json
```

Write only the verified edits:

```bash
metta-lsp simplify program.metta --write
```

For example:

```metta
(= (answer)
  (* (+ 1 2) 4))
!(+ 2 3)
```

becomes:

```metta
(= (answer) 12)
!5
```

The simplifier builds an e-graph for each selected executable term. E-classes
hold equivalent atoms. Union-find and congruence rebuilding propagate a child
equality into its parents. Saturation asks the MeTTa evaluator for a reduction,
then records the result as an equality only when it has one answer. Extraction
chooses the lowest cost member by atom count, rendered length, then lexical
order.

Every returned edit has a proof record:

```json
{
  "strategy": "equality-saturation",
  "original": "(+ 1 2)",
  "simplified": "3",
  "originalResults": ["3"],
  "simplifiedResults": ["3"],
  "steps": [
    {
      "rule": "metta.reduce",
      "before": "(+ 1 2)",
      "after": "3",
      "results": ["3"]
    }
  ],
  "verified": true
}
```

Before returning the edit, MeTTa-LSP evaluates the original and extracted terms
again in the same visible declaration context. Their ordered result lists must
be alpha-equivalent. `verifySimplificationProof` performs the same replay for a
stored proof.

This check matters because MeTTa rules can override built-ins:

```metta
(= (+ $x $y) 99)
!(+ 1 2)
```

The correct simplification in that context is `99`, not `3`. A second rule that
adds another result makes the call nondeterministic, so the simplifier leaves
it unchanged.

The refactoring pass does not evaluate effectful operations. It rejects calls
that reach mutable spaces, state, I/O, concurrency, or nondeterministic
operators. It also leaves patterns, type declarations, and quoted data alone.
Arbitrary `(= left right)` rules are directional reductions, so MeTTa-LSP does
not assume that they are bidirectional equations.

Use `--fuel`, `--max-iterations`, and `--max-nodes` to lower the default
saturation bounds.

## Editor, LSP, and MCP

The editor offers `Simplify expression with verified MeTTa reduction` as a
`refactor.rewrite` code action on executable terms. Run
`MeTTa: Simplify with Verified Reduction` from the command palette to simplify
the current selection or every executable term in the file.

LSP clients can call:

- `metta/simplify` with `{ "uri": "...", "range": { ... } }`
- `metta/deduplicate` with `{ "uri": "...", "minAtoms": 8, "minLines": 1 }`
- `workspace/executeCommand` with `metta.lsp.simplify`

MCP clients use `lsp_simplify` or `metta_simplify`. Set `apply: true` to write
the verified simplification. `lsp_deduplicate` and `metta_deduplicate` return
the semantic clone report without changing files.

The browser-safe language-service module exports:

```ts
import {
  deduplicate,
  simplifyDocument,
  simplifyExpression,
  verifySimplificationProof,
} from "metta-ts-lsp/dist/language-service/index.js";
```

`deduplicate` accepts multiple `{ uri, text }` documents. The simplification
functions accept an optional visible declaration context and saturation bounds.

## Design references

The clone detector follows the AST normalization family used by
[DECKARD](https://doi.org/10.1145/1321631.1321742) and
[NiCad](https://doi.org/10.1109/ICPC.2011.26), but uses MeTTa atoms and
alpha-equivalence instead of generic AST vectors or identifier text. Its
threshold and report model follows [jscpd](https://github.com/kucherenko/jscpd).

The simplifier follows the equality-saturation model described in
[egg: Fast and Extensible Equality Saturation](https://doi.org/10.1145/3434304).
MeTTa's evaluator supplies the admitted reductions and replays the final proof.
