// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The LSP's builtin arity diagnostic must agree with the interpreter: it flags a call's argument count iff
// the evaluator itself rejects it with IncorrectNumberOfArguments. The oracle is @metta-ts/core's own
// evaluation, so a hand-maintained arity table that drifts (type-cast wanting 3 not 2, `+` being binary not
// variadic) fails here. This is the differential guarding the delegation of builtin arity to core's analyze.

import { format, runProgram } from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function lspFlagsArity(call: string): boolean {
  return analyzerWith(call)
    .validate(URI)
    .some((diagnostic) => diagnostic.code === "call.arity");
}

function interpreterRejectsArity(call: string): boolean {
  return runProgram(`!${call}`, 50_000)
    .flatMap((query) => query.results.map(format))
    .some((result) => result.includes("IncorrectNumberOfArguments"));
}

// Builtin calls spanning correct and incorrect argument counts. Each is checked both ways.
const CORPUS = [
  "(type-cast 5 Number)",
  "(type-cast 5 Number &self)",
  "(+ 1 2 3)",
  "(+ 1 2)",
  "(- 5)",
  "(- 5 2)",
  "(* 2 3 4)",
  "(car-atom (1 2))",
  "(car-atom (1 2) 3)",
  "(cdr-atom (1 2))",
  "(chain (+ 1 1) $x $x)",
  "(if True 1 2)",
  "(cons-atom 1 (2 3))",
  "(size-atom (1 2 3))",
];

describe("LSP builtin arity agrees with the interpreter", () => {
  for (const call of CORPUS) {
    it(`agrees on ${call}`, () => {
      expect(lspFlagsArity(call)).toBe(interpreterRejectsArity(call));
    });
  }
});
