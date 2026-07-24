// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// action.notRun is import.notRun's general case. A top-level form runs only with a leading `!`; everything
// else is added to the space as data. For an op the standard library declares to return the unit type `(->)`
// that is always a mistake: the op exists for its effect, and stored as data it has none, with nothing
// reported. An unbanged (assertEqualToResult …) therefore reads as a passing test.

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

const codesFor = (main: string): string[] =>
  analyzerFor(main)
    .validate(MAIN)
    .map((diagnostic) => String(diagnostic.code));

describe("action.notRun", () => {
  it("warns on a bare assertion that never runs, and offers to add !", () => {
    const analyzer = analyzerFor("(assertEqual (+ 1 1) 2)");
    const diagnostic = analyzer.validate(MAIN).find((d) => d.code === "action.notRun");
    expect(diagnostic?.message).toContain("does not run");
    expect(diagnostic?.message).toContain("Prefix it with !");
    const fix = analyzer
      .codeActions(MAIN, diagnostic!.range)
      .find((action) => action.title === "Add ! to run this assertEqual");
    expect(fix?.isPreferred).toBe(true);
    const edit = fix?.edit?.changes?.[MAIN]?.[0];
    expect(edit?.newText).toBe("!");
    expect(edit?.range.start).toStrictEqual({ line: 0, character: 0 });
  });

  it("covers the assert form the retraction bug was written as", () => {
    expect(codesFor("(assertEqualToResult (helper 1) (1))")).toContain("action.notRun");
  });

  it("covers space mutation and output ops", () => {
    expect(codesFor("(add-atom &self (fact a))")).toContain("action.notRun");
    expect(codesFor('(println! "hi")')).toContain("action.notRun");
  });

  it("stays silent on the banged form", () => {
    expect(codesFor("!(assertEqual (+ 1 1) 2)")).not.toContain("action.notRun");
  });

  it("stays silent when a comment separates the ! from its form", () => {
    // The parser binds a pending top-level ! to the next form across comments, so this layout does run.
    expect(codesFor(";; check\n!(assertEqual (+ 1 1) 2)")).not.toContain("action.notRun");
  });

  it("leaves rules, type declarations, and plain data alone", () => {
    expect(codesFor("(= (run) (assertEqual 1 1))")).not.toContain("action.notRun");
    expect(codesFor("(: my-op (-> Number Number))")).not.toContain("action.notRun");
    expect(codesFor("(likes Sam pizza)")).not.toContain("action.notRun");
  });

  it("leaves a nested assertion alone: only a top-level form carries the bang", () => {
    expect(codesFor("(= (suite) (assertEqual 1 1))")).not.toContain("action.notRun");
  });

  it("defers to import.notRun for a bare import, which names the module", () => {
    const codes = codesFor("(import! &self lib)");
    expect(codes).toContain("import.notRun");
    expect(codes).not.toContain("action.notRun");
  });

  it("reads the unit return type from a user declaration, not a list of builtin names", () => {
    expect(codesFor("(: my-effect (-> Number (->)))\n(my-effect 1)")).toContain("action.notRun");
  });

  it("is gated by diagnostics.actionNotRun", () => {
    const analyzer = analyzerFor("(assertEqual (+ 1 1) 2)");
    const codes = analyzer
      .validate(MAIN, { ...DEFAULT_SETTINGS.diagnostics, actionNotRun: false })
      .map((d) => d.code);
    expect(codes).not.toContain("action.notRun");
  });

  it("attaches a docs codeDescription to the catalogued code when a base is set", () => {
    const analyzer = analyzerFor("(assertEqual (+ 1 1) 2)");
    expect(
      analyzer.validate(MAIN).find((d) => d.code === "action.notRun")?.codeDescription,
    ).toBeUndefined();
    analyzer.updateSettings({ docs: { baseUrl: "https://docs.example/metta" } });
    expect(
      analyzer.validate(MAIN).find((d) => d.code === "action.notRun")?.codeDescription?.href,
    ).toBe("https://docs.example/metta/diagnostics/action.notRun");
  });
});
