// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Validate the shipped TextMate grammar in pure TypeScript: compile each repository pattern with the native
// RegExp engine (the grammar uses only lookbehind/lookahead, which V8 supports, so no Oniguruma/WASM engine
// is needed) and assert the token each one matches. This proves the metta-lang.dev lexical model: the
// syntactic tokens are scoped, a standalone `!` is control while `import!`'s trailing `!` is not, and
// capitalized type/value atoms are scoped even in hover code fences where semantic tokens do not run.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

interface GrammarPattern {
  readonly name?: string;
  readonly match?: string;
}
interface GrammarRepo {
  readonly patterns?: readonly GrammarPattern[];
}
interface Grammar {
  readonly scopeName: string;
  readonly repository: Record<string, GrammarRepo>;
}

const grammarPath = path.resolve(process.cwd(), "syntaxes/metta.tmLanguage.json");
const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf8")) as Grammar;

// The compiled regex of a repository match-pattern (non-global, so exec() returns the first hit).
function re(repo: string, index = 0): RegExp {
  const pattern = grammar.repository[repo]?.patterns?.[index]?.match;
  if (pattern === undefined) throw new Error(`no match pattern for ${repo}[${index}]`);
  return new RegExp(pattern);
}

// The whole substring the pattern first matches in `text`, or null when it does not match.
function firstMatch(repo: string, text: string, index = 0): string | null {
  return re(repo, index).exec(text)?.[0] ?? null;
}

const LEXICAL = [
  "variable",
  "space",
  "doctag",
  "control",
  "operator",
  "standard-type",
  "special-type",
];

describe("MeTTa TextMate grammar", () => {
  it("uses only lexical scopes plus capitalized type/value atoms", () => {
    expect(grammar.scopeName).toBe("source.metta");
    expect(Object.keys(grammar.repository).sort()).toEqual([
      "char",
      "comment",
      "control",
      "doctag",
      "number",
      "operator",
      "paren",
      "space",
      "special-type",
      "standard-type",
      "string",
      "variable",
    ]);
  });

  it("matches variables, space refs, and doc atoms", () => {
    expect(firstMatch("variable", "($x-1 foo)")).toBe("$x-1");
    expect(re("variable").test("foo")).toBe(false);
    expect(firstMatch("space", "(&self)")).toBe("&self");
    expect(firstMatch("doctag", "(@doc foo)")).toBe("@doc");
  });

  it("matches numbers, not digits embedded in a symbol", () => {
    expect(firstMatch("number", "(f 42)", 1)).toBe("42");
    expect(firstMatch("number", "(f 3.14)", 0)).toBe("3.14");
    expect(firstMatch("number", "(f -5)", 1)).toBe("-5");
    expect(re("number", 1).test("a42b")).toBe(false);
  });

  it("matches the core operators only as standalone atoms", () => {
    expect(firstMatch("control", "(: x T)")).toBe(":");
    expect(firstMatch("control", "(= (f) 1)")).toBe("=");
    expect(firstMatch("control", "(-> A B)")).toBe("->");
    expect(firstMatch("control", "(! (foo))")).toBe("!");
    expect(firstMatch("operator", "(== 1 1)")).toBe("==");
    expect(firstMatch("operator", "(!= 1 2)")).toBe("!=");
    // The trailing ! of import!, the `=` pair of `==`, and the colons in `::` are not control atoms.
    expect(re("control").exec("(import! m)")).toBeNull();
    expect(re("control").exec("(== 1 1)")).toBeNull();
    expect(re("control").exec("(:: x)")).toBeNull();
    expect(re("control").exec("(a :: b)")).toBeNull();
  });

  it("matches type-looking atoms for source and hover code fences", () => {
    expect(firstMatch("standard-type", "(: quote (-> Atom Atom))")).toBe("Atom");
    expect(firstMatch("standard-type", "(: predicate (-> Number Bool))")).toBe("Number");
    expect(firstMatch("standard-type", "(: perimeter (-> Shape Number))")).toBe("Shape");
    expect(firstMatch("standard-type", "!(if True False Bool)")).toBe("True");
    expect(re("standard-type").test("fooBool")).toBe(false);
    expect(re("standard-type").test("quote")).toBe(false);
  });

  it("matches meta-types and leaves lower-case content symbols default", () => {
    expect(firstMatch("special-type", "(: x %Undefined%)")).toBe("%Undefined%");
    // Lower-case keywords and plain symbols match no lexical pattern; semantic tokens colour known forms.
    for (const symbol of ["if", "foobar"]) {
      for (const repo of LEXICAL) expect(re(repo).test(symbol)).toBe(false);
      expect(re("number", 0).test(symbol)).toBe(false);
      expect(re("number", 1).test(symbol)).toBe(false);
    }
  });
});
