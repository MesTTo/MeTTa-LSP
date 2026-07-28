// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { simplifyDocument, simplifyExpression, verifySimplificationProof } from "../simplify.js";

describe("simplifyExpression", () => {
  it("saturates nested ground reductions and extracts the smallest atom", () => {
    const result = simplifyExpression("(* (+ 1 2) 4)");

    expect(result?.after).toBe("12");
    expect(result?.proof.strategy).toBe("equality-saturation");
    expect(result?.proof.steps.length).toBeGreaterThan(0);
    expect(verifySimplificationProof(result!.proof)).toBe(true);
  });

  it("uses symbolic MeTTa reduction for open expressions", () => {
    const result = simplifyExpression("(if True (pair $x $x) (println! never))");

    expect(result?.after).toBe("(pair $x $x)");
    expect(verifySimplificationProof(result!.proof)).toBe(true);
  });

  it("respects user overrides instead of assuming built-in algebra", () => {
    const context = "(= (+ $x $y) 99)";
    const result = simplifyExpression("(+ 1 2)", { context });

    expect(result?.after).toBe("99");
    expect(result?.proof.originalResults).toEqual(["99"]);
    expect(verifySimplificationProof(result!.proof, context)).toBe(true);
  });

  it("rejects nondeterministic overrides and effectful expressions", () => {
    expect(
      simplifyExpression("(if True A B)", {
        context: "(= (if $condition $then $else) overridden)",
      }),
    ).toBeNull();
    expect(simplifyExpression("(println! hello)")).toBeNull();
    expect(
      simplifyExpression("(if True A B)", {
        context: "(= (if $condition $then $else) (println! should-not-run))",
      }),
    ).toBeNull();
    expect(simplifyExpression("(random-int 1 10)")).toBeNull();
  });

  it("stops at configured saturation bounds", () => {
    const result = simplifyExpression("(* (+ 1 2) 4)", { maxIterations: 1, maxNodes: 5 });
    expect(result === null || result.proof.iterations <= 1).toBe(true);
  });
});

describe("simplifyDocument", () => {
  it("simplifies banged queries and definition bodies without rewriting patterns or quoted data", () => {
    const source = [
      "(= (f $x) (if True (+ 1 2) $x))",
      "(= (quoted) (quote (+ 1 2)))",
      "!(+ 2 3)",
    ].join("\n");
    const result = simplifyDocument(source);

    expect(result.complete).toBe(true);
    expect(result.text).toBe(["(= (f $x) 3)", "(= (quoted) (quote (+ 1 2)))", "!5"].join("\n"));
    expect(result.edits).toHaveLength(2);
  });

  it("simplifies the smallest executable expression selected by offset", () => {
    const source = "(= (f) (pair (+ 1 2) (* 3 4)))";
    const start = source.indexOf("(+");
    const result = simplifyDocument(source, { range: { start, end: start } });

    expect(result.text).toBe("(= (f) (pair 3 (* 3 4)))");
    expect(result.edits).toHaveLength(1);
  });

  it("allows case bodies but not case patterns as selected refactoring targets", () => {
    const source = "!(case 3 (((+ 1 2) no) (3 (+ 4 5))))";
    const patternStart = source.indexOf("(+ 1 2)");
    const bodyStart = source.indexOf("(+ 4 5)");

    expect(
      simplifyDocument(source, { range: { start: patternStart, end: patternStart } }).issues,
    ).toContainEqual(expect.objectContaining({ code: "invalid-selection" }));
    expect(simplifyDocument(source, { range: { start: bodyStart, end: bodyStart } }).text).toBe(
      "!(case 3 (((+ 1 2) no) (3 9)))",
    );
  });

  it("reports malformed source and non-executable selections", () => {
    expect(simplifyDocument("!(+ 1 2").complete).toBe(false);
    const source = "(= (f (+ 1 2)) result)";
    const start = source.indexOf("(+");
    expect(simplifyDocument(source, { range: { start, end: start } }).issues).toContainEqual(
      expect.objectContaining({ code: "invalid-selection" }),
    );
  });
});
