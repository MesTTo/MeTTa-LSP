// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Hierarchical document symbols. A symbol's type signature and its rewrite clauses collapse into one outline
// entry, with the signature and each clause as children, instead of repeating the name as sibling rows. A
// symbol with a single definition stays a flat leaf.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { comparePosition } from "../types.js";

const URI = "file:///ws/m.metta";

const SRC = [
  "(: double (-> Number Number))",
  "(= (double $x) (+ $x $x))",
  "(= (double $x) (* 2 $x))",
  "(: Color Type)",
].join("\n");

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

describe("hierarchical document symbols", () => {
  it("groups a signature and its rewrite clauses under one outline entry", () => {
    const symbols = analyzerWith(SRC).documentSymbols(URI);
    // one entry per symbol, in source order
    expect(symbols.map((symbol) => symbol.name)).toStrictEqual(["double", "Color"]);
    const double = symbols.find((symbol) => symbol.name === "double");
    // signature + two clauses
    expect(double?.children?.length).toBe(3);
    // a leaf symbol keeps no children
    expect(symbols.find((symbol) => symbol.name === "Color")?.children ?? []).toStrictEqual([]);
  });

  it("spans the parent range across every clause and keeps children inside it", () => {
    const double = analyzerWith(SRC)
      .documentSymbols(URI)
      .find((symbol) => symbol.name === "double");
    expect(double).toBeDefined();
    // parent range spans the signature (line 0) through the last clause (line 2)
    expect(double?.range.start.line).toBe(0);
    expect(double?.range.end.line).toBe(2);
    for (const child of double?.children ?? []) {
      // LSP requires each child range within the parent, and its selectionRange within its own range
      expect(
        comparePosition(child.range.start, double?.range.start ?? child.range.start),
      ).toBeGreaterThanOrEqual(0);
      expect(
        comparePosition(child.range.end, double?.range.end ?? child.range.end),
      ).toBeLessThanOrEqual(0);
      expect(comparePosition(child.selectionRange.start, child.range.start)).toBeGreaterThanOrEqual(
        0,
      );
      expect(comparePosition(child.selectionRange.end, child.range.end)).toBeLessThanOrEqual(0);
    }
  });

  it("labels the clause children by their call shape and the signature by its type", () => {
    const double = analyzerWith(SRC)
      .documentSymbols(URI)
      .find((symbol) => symbol.name === "double");
    const childNames = (double?.children ?? []).map((child) => child.name);
    // the two `=` clauses show their pattern; the signature shows the arrow type
    expect(childNames.filter((name) => name === "(double $x)").length).toBe(2);
    expect(childNames.some((name) => name.includes("->"))).toBe(true);
  });

  it("anchors the parent to the symbol name and shows a function icon when implemented", () => {
    const double = analyzerWith(SRC)
      .documentSymbols(URI)
      .find((symbol) => symbol.name === "double");
    // the parent's selection range points at the `double` occurrence in the first definition (the signature)
    expect(double?.selectionRange.start.line).toBe(0);
    // SymbolKind.Function === 12: the presence of `=` clauses makes the grouped symbol a function, not a type
    expect(double?.kind).toBe(12);
  });
});
