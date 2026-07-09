# Programmatic API

The language server is also a library. Instead of wiring an analyzer and a file provider, you can call one
function on a string of MeTTa and get the same structured results the editor receives. That keeps tests,
scripts, browser tools, and MCP tools on the same code path as the LSP server.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

```ts
import { lint, diagnostics, format, run } from "metta-ts-lsp/dsl";

lint("(= (f $x) (if True 1 2))");          // → [{ ruleId: "constant-if-true", ... }]
diagnostics("(car-atomm (1 2))");           // → [{ code: "symbol.possibleTypo", ... }]
format("(=   (f   $x)   $x)");              // → "(= (f $x) $x)"
await run("(= (double $x) (* $x 2))\n!(double 21)"); // → results including "42"
```

Every language-server feature has a one-shot function: `lint`, `diagnostics`, `format`, `hover`,
`definition`, `references`, `symbols`, `completions`, `codeActions`, `explain`, `pseudocode`, and `run`.

## A reusable document

For several queries on the same code, build one document handle so it parses once. Positions accept an
LSP `{ line, character }` (0-based) or a plain character offset into the source.

```ts
import { metta } from "metta-ts-lsp/dsl";

const doc = metta("(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))\n!(inc 5)");
doc.hover(4);                       // by offset
doc.hover({ line: 0, character: 4 }); // or a position
doc.symbols();
doc.pseudocode();                   // ["inc($x) = $x + 1", "inc(5)"]
doc.analyzer;                       // the underlying analyzer, for anything not surfaced here
```

## Sharing the surface

The one-shot functions build a fresh in-memory analyzer with no filesystem, so they see the built-in
rules and no project configuration. When you already have a configured analyzer — with project
`lint.metta`, workspace imports, and the host bridge — wrap it instead:

```ts
import { MettaDoc } from "metta-ts-lsp/dsl";
const doc = MettaDoc.over(analyzer, uri);
doc.lint();   // project rules included
```

The command-line tool does exactly this, so the CLI and the programmatic API run the same query methods
and cannot drift.
