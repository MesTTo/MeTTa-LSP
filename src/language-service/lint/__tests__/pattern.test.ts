// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The structural matcher: exact structure, metavar capture and consistency, the ellipsis, literal variables,
// and reflexivity (a pattern compiled from a form matches that form).

import { parseCst, standardTokenizer } from "@metta-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { richFormArb } from "../../../__fixtures__/mettaProgramArb.js";
import { type Bindings, compilePattern, matchAt } from "../pattern.js";

const tk = standardTokenizer();

// Match a pattern source against a target source (first top-level form of each).
function match(patternSrc: string, targetSrc: string): Bindings | null {
  const pattern = compilePattern(patternSrc);
  if (pattern === null) throw new Error(`bad pattern: ${patternSrc}`);
  const target = parseCst(targetSrc, tk).nodes[0];
  if (target === undefined) throw new Error(`bad target: ${targetSrc}`);
  return matchAt(pattern, target, targetSrc);
}

const textOf = (binds: Bindings, name: string, src: string): string | undefined => {
  const b = binds.get(name);
  if (b === undefined || !("one" in b)) return undefined;
  return src.slice(b.one.span.start, b.one.span.end);
};

describe("structural matcher", () => {
  it("matches identical structure with no metavariables", () => {
    expect(match("(foo 1 2)", "(foo 1 2)")).not.toBeNull();
    expect(match("(foo 1 2)", "(foo 1 3)")).toBeNull();
    expect(match("(foo 1 2)", "(foo 1)")).toBeNull();
  });

  it("captures a metavariable", () => {
    const binds = match("(foo $X)", "(foo (bar baz))");
    expect(binds).not.toBeNull();
    expect(textOf(binds ?? new Map(), "X", "(foo (bar baz))")).toBe("(bar baz)");
  });

  it("requires a repeated metavariable to bind the same subterm", () => {
    expect(match("(eq $X $X)", "(eq a a)")).not.toBeNull();
    expect(match("(eq $X $X)", "(eq a b)")).toBeNull();
  });

  it("matches anything with the wildcard, capturing nothing", () => {
    const binds = match("(foo $_)", "(foo (deeply nested))");
    expect(binds).not.toBeNull();
    expect(binds?.size).toBe(0);
  });

  it("distinguishes a literal variable from a metavariable", () => {
    // lowercase $x is a literal: it matches a variable named $x, not a symbol or another variable
    expect(match("(foo $x)", "(foo $x)")).not.toBeNull();
    expect(match("(foo $x)", "(foo bar)")).toBeNull();
    expect(match("(foo $x)", "(foo $y)")).toBeNull();
  });

  it("matches zero or more with an ellipsis", () => {
    expect(match("(foo $$$)", "(foo)")).not.toBeNull();
    expect(match("(foo $$$)", "(foo a)")).not.toBeNull();
    expect(match("(foo $$$)", "(foo a b c)")).not.toBeNull();
  });

  it("captures the run an ellipsis matched", () => {
    const src = "(foo a b c)";
    const binds = match("(foo $$$rest)", src);
    const rest = binds?.get("rest");
    expect(rest !== undefined && "many" in rest ? rest.many.length : -1).toBe(3);
  });

  it("matches an ellipsis in the middle and at the tail", () => {
    expect(match("(foo $$$ last)", "(foo a b last)")).not.toBeNull();
    expect(match("(foo $$$ last)", "(foo last)")).not.toBeNull();
    expect(match("(foo $$$ last)", "(foo a b)")).toBeNull();
  });

  it("matches a nested definition shape (definition head plus body)", () => {
    // (= ($F $$$) $$$) — a function definition with any head and any body
    expect(match("(= ($F $$$) $$$)", "(= (fact $n) (if (== $n 0) 1 x))")).not.toBeNull();
    expect(match("(= ($F $$$) $$$)", "(: fact (-> Number Number))")).toBeNull();
  });

  it("rejects a leaf-kind mismatch", () => {
    expect(match("42", "foo")).toBeNull();
    expect(match("foo", "42")).toBeNull();
    expect(match('"hi"', "hi")).toBeNull();
  });

  it("compiles a well-formed single form and rejects the rest", () => {
    expect(compilePattern("(a b)")).not.toBeNull();
    expect(compilePattern("(a b")).toBeNull();
    expect(compilePattern("(a) (b)")).toBeNull();
    expect(compilePattern("")).toBeNull();
  });

  it("a pattern compiled from a form matches that form (reflexivity)", () => {
    expect(() =>
      fc.assert(
        fc.property(richFormArb(3), (formSrc) => {
          const pattern = compilePattern(formSrc);
          if (pattern === null) return true;
          const target = parseCst(formSrc, tk).nodes[0];
          if (target === undefined) return true;
          return matchAt(pattern, target, formSrc) !== null;
        }),
        { numRuns: 500 },
      ),
    ).not.toThrow();
  });
});
