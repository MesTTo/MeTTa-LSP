// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The ergonomic DSL: one-shot functions and a reusable document handle over the analyzer. Positions may
// be an LSP position or a plain offset; run() evaluates through the guarded runtime; over() wraps an existing
// analyzer so the CLI shares this surface.

import { describe, expect, it, vi } from "vitest";
import { Analyzer } from "../../server/analyzer.js";
import { InMemoryFileProvider } from "../../server/fileProvider.js";
import {
  codeActions,
  diagnostics,
  format,
  lint,
  MettaDoc,
  metta,
  pseudocode,
  run,
  symbols,
} from "../index.js";

describe("one-shot functions", () => {
  it("lints a redundant if", () => {
    const findings = lint("(= (f $x) (if True 1 2))");
    expect(findings.some((finding) => finding.ruleId === "constant-if-true")).toBe(true);
  });

  it("reports a did-you-mean hint for a near-miss head", () => {
    // An unknown head is data in MeTTa, but a Levenshtein near-miss of a builtin gets a possible-typo hint.
    const codes = diagnostics("(car-atomm (1 2))").map((diagnostic) => diagnostic.code);
    expect(codes).toContain("symbol.possibleTypo");
  });

  it("formats source with the pretty-printer", () => {
    expect(format("(=   (f   $x)   $x)")).toContain("(= (f $x) $x)");
  });

  it("run returns the guarded result contract", async () => {
    // The evaluation itself runs in the isolated worker, which vitest cannot resolve from .ts source, so
    // this pins only the contract (guarded=true); scripts/smoke-dsl.mjs proves run() → 42 against dist.
    const result = await run("!(+ 1 2)");
    expect(result.guarded).toBe(true);
  });

  it("lists document symbols and renders pseudocode", () => {
    const src = "(= (twice $x) (+ $x $x))\n!(twice 5)";
    expect(symbols(src).some((symbol) => symbol.name.includes("twice"))).toBe(true);
    expect(pseudocode(src).some((line) => line.includes("twice(5)"))).toBe(true);
  });
});

describe("MettaDoc handle", () => {
  const doc = metta("(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))\n!(inc 5)");

  it("hovers by offset and by position identically", () => {
    // `inc` in the type declaration starts at offset 3.
    const byOffset = doc.hover(4);
    const byPosition = doc.hover({ line: 0, character: 4 });
    expect(byOffset?.contents).toStrictEqual(byPosition?.contents);
    expect(JSON.stringify(byOffset?.contents)).toContain("inc");
  });

  it("offers the add-type action on an untyped function via codeActions", () => {
    const titles = codeActions("(= (g $x) (+ $x 1))", 4).map((action) => action.title);
    expect(titles.some((title) => title.startsWith("Add type declaration"))).toBe(true);
  });
});

describe("MettaDoc.over shares an existing analyzer", () => {
  it("wraps a configured analyzer and answers with its state", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/a.metta";
    const src = "(= (f $x) (if True 1 2))";
    files.writeFile("/ws/a.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const doc = MettaDoc.over(analyzer, uri);
    expect(doc.analyzer).toBe(analyzer);
    expect(doc.source).toBe(src);
    expect(doc.lint().some((finding) => finding.ruleId === "constant-if-true")).toBe(true);
  });

  it("restores pseudocode settings when code-lens generation throws", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/a.metta";
    files.writeFile("/ws/a.metta", "!(+ 1 2)");
    const analyzer = new Analyzer(files);
    analyzer.updateDocument(uri, "!(+ 1 2)", 1, true);
    vi.spyOn(analyzer, "codeLenses").mockImplementation(() => {
      throw new Error("lens failure");
    });

    expect(() => MettaDoc.over(analyzer, uri).pseudocode()).toThrow("lens failure");
    expect(analyzer.getSettings().pseudocode.enabled).toBe(false);
  });
});
