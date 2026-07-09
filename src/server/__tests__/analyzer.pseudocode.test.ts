// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Pseudocode mode: off by default, and when on it adds a mixfix-reading code lens above each top-level
// form (the bang marker folds into the form it precedes), left of the run lens.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/p.metta";
const SRC = "(= (fact $n) (* $n 2))\n!(fact 5)";

function analyzerWith(src: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/p.metta", src);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, src, 1, true);
  return analyzer;
}

function pseudocodeTitles(analyzer: Analyzer): string[] {
  return analyzer
    .codeLenses(URI)
    .filter((lens) => lens.command?.command === "metta.explainForm")
    .map((lens) => lens.command?.title ?? "");
}

describe("pseudocode mode", () => {
  it("adds no pseudocode lenses by default", () => {
    expect(pseudocodeTitles(analyzerWith(SRC))).toStrictEqual([]);
  });

  it("renders each top-level form in mixfix when enabled", () => {
    const analyzer = analyzerWith(SRC);
    analyzer.updateSettings({ pseudocode: { enabled: true } });
    const titles = pseudocodeTitles(analyzer);
    // The rewrite rule and the banged query each get one lens; the bang folds into its form.
    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain("≡ ");
    expect(titles.some((title) => title.includes("fact(5)"))).toBe(true);
    expect(titles.some((title) => title.includes("*") || title.includes("×"))).toBe(true);
  });

  it("places the pseudocode lens at the form's start line, above the run lens", () => {
    const analyzer = analyzerWith(SRC);
    analyzer.updateSettings({ pseudocode: { enabled: true } });
    const lenses = analyzer.codeLenses(URI);
    const queryPseudo = lenses.find((lens) => lens.command?.title.includes("fact(5)") === true);
    // The query is on line 1; its pseudocode lens anchors there, at column 0 (left of the run lens).
    expect(queryPseudo?.range.start).toStrictEqual({ line: 1, character: 0 });
    expect(queryPseudo?.command?.arguments?.[0]).toStrictEqual({
      uri: URI,
      position: { line: 1, character: 1 },
    });
  });
});
