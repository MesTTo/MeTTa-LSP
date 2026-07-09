// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Linked editing links every occurrence of a logic variable within its rule, so renaming one renames all as
// the user types. It applies only to variables that occur more than once.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function analyze(source: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

describe("Analyzer.linkedEditingRanges", () => {
  it("links every occurrence of a variable in its rule", () => {
    // (= (f $x) (g $x $x)) — the three $x occurrences link together (cursor on the first, at char 6).
    const result = analyze("(= (f $x) (g $x $x))").linkedEditingRanges(MAIN, {
      line: 0,
      character: 6,
    });
    expect(result?.ranges).toHaveLength(3);
  });

  it("returns null for a variable that occurs once", () => {
    expect(analyze("(= (f $x) 1)").linkedEditingRanges(MAIN, { line: 0, character: 6 })).toBeNull();
  });

  it("returns null on a non-variable symbol", () => {
    const analyzer = analyze("(= (f $x) (g $x $x))");
    expect(analyzer.linkedEditingRanges(MAIN, { line: 0, character: 4 })).toBeNull();
  });
});
