// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The semantic linter reads inert definitions and applies the fixed rule set without running user queries.
// These assertions pin the rule semantics, not interpreter behavior.

import { describe, expect, it } from "vitest";
import { runSemanticLint } from "../semantic.js";

const rules = (src: string, severities = {}) =>
  runSemanticLint(src, severities).map((v) => `${v.rule}:${v.symbol}`);

describe("runSemanticLint", () => {
  it("flags a recursive function with no type declaration", () => {
    const found = rules("(= (fact $n) (if (== $n 0) 1 (* $n (fact (- $n 1)))))");
    expect(found).toContain("missing-recursive-type:fact");
  });

  it("does not flag a recursive function that has a type declaration", () => {
    const found = rules(
      "(: fact (-> Number Number))\n(= (fact $n) (if (== $n 0) 1 (* $n (fact (- $n 1)))))",
    );
    expect(found).not.toContain("missing-recursive-type:fact");
  });

  it("does not flag a non-recursive function without a type declaration", () => {
    // that is the syntactic missing-type-declaration rule's job; the recursive check must stay quiet here
    const found = rules("(= (double $x) (* $x 2))");
    expect(found).not.toContain("missing-recursive-type:double");
  });

  it("flags clauses of different arity once, despite multiple clauses", () => {
    const found = rules("(= (g 0) 1)\n(= (g $x $y) $x)");
    expect(found.filter((f) => f === "inconsistent-arity:g")).toHaveLength(1);
  });

  it("finds several functions' violations together", () => {
    const found = rules("(= (fact $n) (fact (- $n 1)))\n(= (g 0) 1)\n(= (g $x $y) $x)");
    expect(found).toContain("missing-recursive-type:fact");
    expect(found).toContain("inconsistent-arity:g");
  });

  it("honors a severity override that turns a rule off", () => {
    const found = rules("(= (fact $n) (fact (- $n 1)))", {
      "missing-recursive-type": "off",
    });
    expect(found).not.toContain("missing-recursive-type:fact");
  });

  it("keeps the configured severity on emitted violations", () => {
    const [found] = runSemanticLint("(= (fact $n) (fact (- $n 1)))", {
      "missing-recursive-type": "warn",
    });
    expect(found).toMatchObject({
      rule: "missing-recursive-type",
      severity: "warn",
      symbol: "fact",
    });
  });

  it("ignores banged query forms", () => {
    const found = rules("!(= (fact $n) (fact (- $n 1)))");
    expect(found).not.toContain("missing-recursive-type:fact");
  });

  it("returns nothing for a file with no definitions", () => {
    expect(runSemanticLint("!(+ 1 2)")).toEqual([]);
    expect(runSemanticLint("")).toEqual([]);
  });
});
