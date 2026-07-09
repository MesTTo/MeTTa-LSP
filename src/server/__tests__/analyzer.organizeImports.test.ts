// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { offsetAt } from "../parser.js";

const MAIN = "file:///ws/main.metta";

function analyzerFor(source: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/a.metta", "(= (a) 1)");
  files.writeFile("/ws/z.metta", "(= (z) 1)");
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

function applyFirstOrganizeEdit(source: string): string {
  const analyzer = analyzerFor(source);
  const edit = analyzer.organizeImports(MAIN)[0];
  if (edit === undefined) return source;
  const index = analyzer.getDocument(MAIN);
  if (index === undefined) return source;
  const start = offsetAt(edit.range.start, index.parsed.lineOffsets, source.length);
  const end = offsetAt(edit.range.end, index.parsed.lineOffsets, source.length);
  return `${source.slice(0, start)}${edit.newText}${source.slice(end)}`;
}

describe("Analyzer.organizeImports", () => {
  it("sorts a contiguous import-only block without touching following code", () => {
    const source = ["!(import! &self z)", "!(import! &self a)", "(= (main) (a))", ""].join("\n");

    expect(applyFirstOrganizeEdit(source)).toBe(
      ["!(import! &self a)", "!(import! &self z)", "(= (main) (a))", ""].join("\n"),
    );
  });

  it("does not rewrite when code is interleaved between imports", () => {
    const source = ["!(import! &self z)", "(= (main) (a))", "!(import! &self a)", ""].join("\n");

    expect(analyzerFor(source).organizeImports(MAIN)).toStrictEqual([]);
  });

  it("does not rewrite when two imports share one source line", () => {
    const source = "!(import! &self z) !(import! &self a)\n";

    expect(analyzerFor(source).organizeImports(MAIN)).toStrictEqual([]);
  });

  it("preserves duplicate import lines and their comments", () => {
    const source = [
      "!(import! &self z) ; later module",
      "!(import! &self a)",
      "!(import! &self z) ; required twice by the source",
      "",
    ].join("\n");

    expect(applyFirstOrganizeEdit(source)).toBe(
      [
        "!(import! &self a)",
        "!(import! &self z) ; later module",
        "!(import! &self z) ; required twice by the source",
        "",
      ].join("\n"),
    );
  });
});
