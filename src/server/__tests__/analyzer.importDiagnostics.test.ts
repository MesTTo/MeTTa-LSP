// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Import diagnostics cover unresolved modules and imports that are present as data but never run. Quoted
// MeTTa file paths are no longer warned on: @metta-ts/core 1.1.1 resolves them through the import map.

import { describe, expect, it } from "vitest";
import { Analyzer, DEFAULT_SETTINGS } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function analyzerFor(main: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/lib.metta", "(= (helper $x) $x)");
  files.writeFile("/ws/main.metta", main);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, main, 1, true);
  return analyzer;
}

describe("quoted MeTTa imports", () => {
  it("resolves a quoted file path without a style warning", () => {
    const analyzer = analyzerFor('!(import! &self "lib.metta")');
    const codes = analyzer.validate(MAIN).map((candidate) => candidate.code);
    expect(codes).not.toContain("import.unresolved");
    expect(codes).not.toContain("import.notRun");
    expect(Object.keys(analyzer.importSourceMap(MAIN))).toContain("lib.metta");
  });

  it("stays silent on the bare module-symbol form", () => {
    const analyzer = analyzerFor("!(import! &self lib)");
    const codes = analyzer.validate(MAIN).map((candidate) => candidate.code);
    expect(codes).not.toContain("import.unresolved");
  });
});

describe("import.notRun", () => {
  it("warns on a bare (import! …) that never runs, and offers to add !", () => {
    const analyzer = analyzerFor("(import! &self lib)");
    const diagnostic = analyzer.validate(MAIN).find((d) => d.code === "import.notRun");
    expect(diagnostic?.message).toContain("does not run");
    expect(diagnostic?.message).toContain("Prefix it with !");
    const fix = analyzer
      .codeActions(MAIN, diagnostic!.range)
      .find((action) => action.title === "Add ! to run this import");
    expect(fix?.isPreferred).toBe(true);
    const edit = fix?.edit?.changes?.[MAIN]?.[0];
    expect(edit?.newText).toBe("!");
    expect(edit?.range.start).toStrictEqual({ line: 0, character: 0 });
  });

  it("stays silent on the banged form", () => {
    const analyzer = analyzerFor("!(import! &self lib)");
    expect(analyzer.validate(MAIN).map((d) => d.code)).not.toContain("import.notRun");
  });

  it("does not fire on an unresolvable import — that is import.unresolved's job", () => {
    const analyzer = analyzerFor("(import! &self nosuchmod)");
    const codes = analyzer.validate(MAIN).map((d) => d.code);
    expect(codes).toContain("import.unresolved");
    expect(codes).not.toContain("import.notRun");
  });

  it("is gated by diagnostics.importResolution", () => {
    const analyzer = analyzerFor("(import! &self lib)");
    const codes = analyzer
      .validate(MAIN, { ...DEFAULT_SETTINGS.diagnostics, importResolution: false })
      .map((d) => d.code);
    expect(codes).not.toContain("import.notRun");
  });

  it("attaches a docs codeDescription to the catalogued code when a base is set", () => {
    const analyzer = analyzerFor("(import! &self lib)");
    // No base by default: no docs link.
    const withoutBase = analyzer
      .validate(MAIN)
      .find((candidate) => candidate.code === "import.notRun");
    expect(withoutBase?.codeDescription).toBeUndefined();
    // With a base, the diagnostic code links to its catalogue page.
    analyzer.updateSettings({ docs: { baseUrl: "https://docs.example/metta" } });
    const withBase = analyzer
      .validate(MAIN)
      .find((candidate) => candidate.code === "import.notRun");
    expect(withBase?.codeDescription?.href).toBe(
      "https://docs.example/metta/diagnostics/import.notRun",
    );
  });
});
