// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A parameter the interpreter types `Variable` (map-atom/chain/foldl-atom $var slots) binds a $-variable. A
// plain symbol there type-checks — Hyperon and metta-ts both accept an untyped symbol — but fails to reduce at
// run time (verified: `(map-atom (a b) x (foo x))` yields a NoReturn error in both). check-types is permissive
// for the untyped symbol, so the LSP flags it separately with a $-prefix suggestion, the feedback MeTTaTron
// gives. A concrete-typed value (a number) is caught by check-types instead, so the two never double-flag.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerFor(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function validate(text: string) {
  return analyzerFor(text).validate(URI);
}

const codes = (text: string): string[] =>
  validate(text)
    .map((d) => String(d.code))
    .filter((code) => code.startsWith("call."));

describe("variable-slot lint", () => {
  it("flags a plain symbol in a variable slot and suggests the $-prefixed form", () => {
    const diag = validate("!(map-atom (a b) x (foo x))").find(
      (d) => d.code === "call.variableSlot",
    );
    expect(diag?.severity).toBe(DiagnosticSeverity.Warning);
    expect(diag?.message).toBe(
      "'map-atom' argument 2 must be a variable (one starting with $) — did you mean '$x'?",
    );
  });

  it("does not flag a variable in the variable slot", () => {
    expect(codes("!(map-atom (a b) $y (foo $y))")).toEqual([]);
  });

  it("flags chain's binding slot and every foldl-atom variable slot", () => {
    expect(codes("!(chain 5 y (foo y))")).toEqual(["call.variableSlot"]);
    // foldl-atom types arguments 3 and 4 (the accumulator and element) as Variable.
    expect(codes("!(foldl-atom (a b) 0 acc el (+ acc el))")).toEqual([
      "call.variableSlot",
      "call.variableSlot",
    ]);
  });

  it("leaves a concrete-typed value to check-types, never double-flagging", () => {
    // 5 is a Number in a Variable slot: check-types produces the BadArgType, the variable-slot lint stays quiet.
    const found = codes("!(map-atom (a b) 5 (foo 5))");
    expect(found).toEqual(["call.typeMismatch"]);
  });

  it("still flags an unsuggestible symbol, without a $-form guess", () => {
    // Capitalized or long names do not read as a forgotten $, so no suggestion, but the slot is still wrong.
    const diag = validate("!(map-atom (a b) Constant (foo Constant))").find(
      (d) => d.code === "call.variableSlot",
    );
    expect(diag?.message).toBe(
      "'map-atom' argument 2 must be a variable (one starting with $); a plain symbol does not reduce here.",
    );
  });

  it("offers a quick-fix that adds the missing $", () => {
    const analyzer = analyzerFor("!(map-atom (a b) x (foo x))");
    const diag = analyzer.validate(URI).find((d) => d.code === "call.variableSlot");
    if (diag === undefined) throw new Error("expected a variable-slot diagnostic");
    const fix = analyzer.codeActions(URI, diag.range).find((a) => a.title === "Change 'x' to '$x'");
    expect(fix?.edit?.changes?.[URI]?.[0]?.newText).toBe("$x");
  });
});
