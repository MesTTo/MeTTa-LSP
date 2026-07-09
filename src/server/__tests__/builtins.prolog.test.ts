// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The Prolog interop family lives in @metta-ts/prolog, not @metta-ts/core. The LSP keeps those heads known so
// Prolog-using MeTTa files do not get false unknown-symbol hints.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { PROLOG_OP_NAMES } from "../builtins.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { expectBuiltinFamilyRegistered, expectNameSetExact } from "./builtinFamilyAssertions.js";

const FAMILY = [
  "prolog-call",
  "prolog-asserta",
  "prolog-assertz",
  "prolog-retract",
  "prolog-match",
  "Predicate",
  "callPredicate",
  "assertaPredicate",
  "assertzPredicate",
  "retractPredicate",
  "prolog-function",
  "import_prolog_function",
  "prolog-consult",
  "import_prolog_functions_from_file",
];

describe("prolog builtins", () => {
  it("registers the whole family with signatures and docs", () => {
    expect.assertions(FAMILY.length * 4);
    expectBuiltinFamilyRegistered(FAMILY);
  });

  it("PROLOG_OP_NAMES is exactly the Prolog bridge family", () => {
    expect.hasAssertions();
    expectNameSetExact(PROLOG_OP_NAMES, FAMILY);
  });

  it("raises no symbol hint on a prolog-using program", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/prolog.metta";
    const src = `
      !(assertzPredicate (Predicate (edge alice bob)))
      !(prolog-assertz (edge alice bob))
      !(prolog-call (edge alice $x))
      !(prolog-retract (edge alice bob))
      !(import_prolog_function edge)
    `;
    files.writeFile("/ws/prolog.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const symbolHints = analyzer
      .validate(uri)
      .filter((diagnostic) => String(diagnostic.code).startsWith("symbol."));
    expect(symbolHints).toStrictEqual([]);
  });
});
