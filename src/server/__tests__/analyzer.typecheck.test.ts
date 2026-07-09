// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The type + arity diagnostics come from the interpreter's own verdict (core's `check-types` op), not a TS type
// heuristic: a wrong argument type is its BadArgType (which argument, expected vs actual), a wrong argument
// count is its IncorrectNumberOfArguments. Which calls are checked is the interpreter's own data-vs-evaluated
// rule, read from the signatures (eval.ts argMask): an argument in a parameter typed Atom, Variable, or
// Expression is left unreduced (quote, add-atom, match patterns, get-type, if branches, collapse), so it is
// data and not checked; a reduced position (arithmetic operands, function bodies) is checked.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function validate(text: string) {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer.validate(URI);
}

const callCodes = (text: string): string[] =>
  validate(text)
    .map((d) => String(d.code))
    .filter((code) => code.startsWith("call."));

describe("interpreter-backed type + arity diagnostics", () => {
  it("reports a wrong argument type as the interpreter's BadArgType (which arg, expected, actual)", () => {
    const diag = validate("!(car-atom 5)").find((d) => d.code === "call.typeMismatch");
    expect(diag?.severity).toBe(DiagnosticSeverity.Warning);
    expect(diag?.message).toBe(
      "Type mismatch for 'car-atom' argument 1: expected Expression, got Number.",
    );
  });

  it("points the type mismatch at the offending argument, not the head", () => {
    const diag = validate('!(+ 1 "hi")').find((d) => d.code === "call.typeMismatch");
    expect(diag?.message).toBe("Type mismatch for '+' argument 2: expected Number, got String.");
    // the range covers the "hi" argument on line 0
    expect(diag?.range.start.line).toBe(0);
  });

  it("reports a wrong argument count as the interpreter's arity error, with the expected count", () => {
    const diag = validate("!(+ 1 2 3)").find((d) => d.code === "call.arity");
    expect(diag?.severity).toBe(DiagnosticSeverity.Warning);
    // The message teaches the call shape by naming the signature, the way MeTTaTron's arity errors do.
    expect(diag?.message).toBe(
      "Argument count mismatch for '+': expected 2, got 3. Its type is (-> Number Number Number).",
    );
  });

  it("checks a typed user function's arity from its declaration", () => {
    const codes = callCodes("(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))\n!(inc 1 2)");
    expect(codes).toContain("call.arity");
  });

  it("does not flag a correct call", () => {
    expect(callCodes("!(+ 1 2)")).toEqual([]);
    expect(callCodes("(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))\n!(inc 5)")).toEqual([]);
  });

  it("does not flag an untyped user function's arity — the interpreter treats it as data", () => {
    // Without a (: f ...) type, `(f 1 2)` matches no rule and is left as data (Hyperon smart dispatch), not an
    // arity error, so neither does the LSP.
    expect(callCodes("(= (f $x) $x)\n!(f 1 2)")).toEqual([]);
  });

  it("flags a bad call in an evaluated argument position", () => {
    // Number-typed operands are reduced, so a bad call there is checked.
    expect(callCodes("!(+ 1 (car-atom 5))")).toContain("call.typeMismatch");
    expect(callCodes("!(* (car-atom 5) 2)")).toContain("call.typeMismatch");
  });

  it("does not flag a bad call in a data position — an Atom/Variable/Expression param is unreduced", () => {
    // The interpreter leaves an argument typed Atom, Variable, or Expression unreduced (eval.ts argMask), so
    // these hold the call as data: quote/noeval hold it, add-atom stores it, match matches the pattern,
    // get-type introspects it, if holds its branches, collapse/sealed take it structurally. None are checked.
    for (const form of [
      "!(quote (car-atom 5))",
      "!(noeval (car-atom 5))",
      "!(add-atom &self (car-atom 5))",
      "!(match &self (car-atom 5) ok)",
      "!(get-type (car-atom 5))",
      "!(if True (car-atom 5) 9)",
      "!(collapse (car-atom 5))",
      "!(sealed (a) (car-atom 5))",
    ]) {
      expect(callCodes(form)).toEqual([]);
    }
  });
});
