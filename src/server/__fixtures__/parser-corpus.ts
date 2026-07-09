// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Differential corpus for the parser. Each snippet is parsed by BOTH @metta-ts/core's `parseAll` and our
// span-CST parser; the two must agree on the top-level atom structure. `adversarial` cases target the exact
// reader boundaries where tree-sitter and hand-rolled MeTTa parsers drift from the interpreter: comma is the
// conjunction head atom (not whitespace), the `!`/`?`/`'` prefix markers change meaning, `;` starts a comment
// and `"` a string, and number forms (`.5`, `3abc`, bare `-`) are read as the interpreter reads them.

export interface CorpusCase {
  readonly name: string;
  readonly src: string;
  readonly kind: "ground" | "adversarial";
  readonly note?: string;
}

export const PARSER_CORPUS: readonly CorpusCase[] = [
  { name: "empty", src: "", kind: "ground" },
  { name: "unit", src: "()", kind: "ground" },
  { name: "symbol", src: "foo", kind: "ground" },
  { name: "simple-def", src: "(= (f $x) (+ $x 1))", kind: "ground" },
  { name: "type-decl", src: "(: foo (-> Number Number))", kind: "ground" },
  { name: "nested", src: "(a (b (c (d))))", kind: "ground" },
  { name: "multiple-forms", src: "(= (f) 1)\n(= (g) 2)", kind: "ground" },
  { name: "int", src: "42", kind: "ground" },
  { name: "negative-int", src: "-7", kind: "ground" },
  { name: "float", src: "3.14", kind: "ground" },
  { name: "bool-true", src: "True", kind: "ground" },
  { name: "bool-false", src: "False", kind: "ground" },
  { name: "string", src: '"hello"', kind: "ground" },
  { name: "var", src: "$x", kind: "ground" },
  { name: "named-space", src: "&self", kind: "ground" },
  { name: "arrow-op", src: "(-> A B)", kind: "ground" },

  {
    name: "comma-conjunction",
    src: "(, (a) (b))",
    kind: "adversarial",
    note: "comma is the (,) conjunction atom, never whitespace",
  },
  {
    name: "comma-word-boundary",
    src: "(foo,bar)",
    kind: "adversarial",
    note: "comma does not split words in the core reader",
  },
  { name: "bang-eval", src: "!(foo 1)", kind: "adversarial", note: "! evaluation prefix" },
  { name: "quote-prefix", src: "'(a b)", kind: "adversarial", note: "' quote prefix" },
  { name: "trailing-comment", src: "(f) ; a comment\n(g)", kind: "adversarial" },
  { name: "header-comment", src: ";; header\n(= (f) 1)", kind: "adversarial" },
  {
    name: "string-with-escape",
    src: '"a \\"quoted\\" b"',
    kind: "adversarial",
    note: "escaped quotes inside a string",
  },
  {
    name: "string-with-paren",
    src: '"(not an expr)"',
    kind: "adversarial",
    note: "parens inside a string are literal",
  },
  { name: "string-with-semicolon", src: '"a ; not a comment"', kind: "adversarial" },
  {
    name: "float-no-leading-digit",
    src: ".5",
    kind: "adversarial",
    note: "read exactly as the interpreter reads it (symbol or float)",
  },
  {
    name: "int-then-symbol",
    src: "3abc",
    kind: "adversarial",
    note: "a single symbol, not int + symbol",
  },
  { name: "dash-symbol", src: "-", kind: "adversarial", note: "bare - is a symbol, not a number" },
  { name: "deep-nesting", src: "((((((x))))))", kind: "adversarial" },
  {
    name: "whitespace-variety",
    src: "(a\t b\n  c)",
    kind: "adversarial",
    note: "tabs/newlines are whitespace",
  },
];
