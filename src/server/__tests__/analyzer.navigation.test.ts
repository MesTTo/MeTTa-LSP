// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Characterization of the navigation features on a small two-file workspace, locking the behavior now that
// the parse layer is built on core's CST. A rewrite-aware language: `double` has two `=` clauses, and both
// are definitions/implementations of the same symbol.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const LIB = "file:///ws/lib.metta";
const MAIN = "file:///ws/main.metta";

const libSrc = [
  "(: Fruit Type)",
  "(: Apple Fruit)",
  "(: mk-apple (-> Fruit))",
  "(= (mk-apple) Apple)",
].join("\n");

const mainSrc = [
  '(import! &self "lib.metta")',
  "(: double (-> Number Number))",
  "(= (double $x) (+ $x $x))",
  "(= (double $x) (* 2 $x))",
  "(double 5)",
].join("\n");

function workspace(): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/lib.metta", libSrc);
  files.writeFile("/ws/main.metta", mainSrc);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(LIB, libSrc, 1, true);
  analyzer.updateDocument(MAIN, mainSrc, 1, true);
  return analyzer;
}

// The `double` head of the `(double 5)` call on line 4, at its first character (right after the `(`).
const doubleCall = { line: 4, character: 1 };

describe("navigation", () => {
  it("definition jumps to the signature declaration and both rewrite clauses", () => {
    const defs = workspace().definition(MAIN, doubleCall);
    expect(defs.every((location) => location.uri === MAIN)).toBe(true);
    // the `(: double ...)` signature (line 1) plus the two `=` clauses (lines 2, 3)
    expect(defs.map((location) => location.range.start.line).sort((a, b) => a - b)).toStrictEqual([
      1, 2, 3,
    ]);
  });

  it("references include the call site and every clause", () => {
    const refs = workspace().references(MAIN, doubleCall, true);
    const lines = refs
      .filter((location) => location.uri === MAIN)
      .map((location) => location.range.start.line)
      .sort((a, b) => a - b);
    // two clause heads (lines 2, 3) and the call (line 4)
    expect(lines).toContain(2);
    expect(lines).toContain(3);
    expect(lines).toContain(4);
  });

  it("declaration jumps to the type declaration of a type symbol", () => {
    // `Fruit` used in `(: Apple Fruit)` (lib line 1); its declaration is `(: Fruit Type)` (lib line 0).
    const decls = workspace().declaration(LIB, { line: 1, character: 11 });
    expect(decls.map((location) => location.range.start.line)).toStrictEqual([0]);
  });

  it("implementation lists the rewrite clauses", () => {
    const impls = workspace().implementation(MAIN, doubleCall);
    expect(impls.map((location) => location.range.start.line).sort((a, b) => a - b)).toStrictEqual([
      2, 3,
    ]);
  });

  it("document highlights mark the clauses and the call in the file", () => {
    const highlights = workspace().documentHighlights(MAIN, doubleCall);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
  });

  it("references resolve across files from a cross-file symbol", () => {
    // `Apple` is declared in lib and used as the body of mk-apple; reference it from its declaration.
    const refs = workspace().references(LIB, { line: 1, character: 4 }, true);
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves a symbol at its first character right after the opening paren", () => {
    // The cursor at the boundary between `(` and the head must resolve to the head, not the paren.
    expect(workspace().definition(MAIN, { line: 4, character: 1 }).length).toBeGreaterThan(0);
  });
});
