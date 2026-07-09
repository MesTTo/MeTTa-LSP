// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// An unknown head is valid data in MeTTa (it reduces to itself), so it is never an "undefined" error. When it
// is a near-miss of a visible name (Levenshtein-bounded, core's consolidated fuzzy engine over the LSP's
// cross-file known set) it gets a HINT-level "did you mean" suggestion and a preferred quick-fix. A head with
// no close match gets nothing at all.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
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

const SRC = "(: fibonacci (-> Number Number))\n(= (fibonacci $n) $n)\n(fibonaci 10)";

describe("did-you-mean hint on a near-miss head", () => {
  it("hints the closest visible name, as a hint and not an error", () => {
    const diag = analyzerWith(SRC)
      .validate(URI)
      .find((diagnostic) => diagnostic.code === "symbol.possibleTypo");
    expect(diag?.severity).toBe(DiagnosticSeverity.Hint);
    expect(diag?.message).toContain("did you mean 'fibonacci'?");
    expect((diag?.data as { suggestion?: string } | undefined)?.suggestion).toBe("fibonacci");
  });

  it("offers a preferred quick-fix that replaces the typo with the suggestion", () => {
    const actions = analyzerWith(SRC).codeActions(URI, {
      start: { line: 2, character: 1 },
      end: { line: 2, character: 9 },
    });
    const fix = actions.find((action) => action.title === "Change 'fibonaci' to 'fibonacci'");
    expect(fix?.isPreferred).toBe(true);
    expect(fix?.edit?.changes?.[URI]?.[0]?.newText).toBe("fibonacci");
  });

  it("does not flag an unknown head with no close match — it is valid data", () => {
    const symbolHints = analyzerWith("(qwxzvbnm 1)")
      .validate(URI)
      .map((diagnostic) => diagnostic.code)
      .filter((code) => String(code).startsWith("symbol."));
    expect(symbolHints).toEqual([]);
  });
});
