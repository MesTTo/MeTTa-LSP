// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///workspace/main.metta";

function analyzerFor(source: string): Analyzer {
  const files = new InMemoryFileProvider("/workspace");
  files.writeFile("/workspace/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///workspace"]);
  analyzer.updateDocument(URI, source, 1, true);
  return analyzer;
}

describe("Analyzer simplification", () => {
  it("returns a verified edit and exposes it as a refactor rewrite", () => {
    const source = "!(+ 1 2)";
    const analyzer = analyzerFor(source);
    const range = {
      start: { line: 0, character: 3 },
      end: { line: 0, character: 3 },
    };

    const result = analyzer.simplify(URI, range);
    expect(result.text).toBe("!3");
    expect(result.edits[0]?.proof.verified).toBe(true);

    const action = analyzer
      .codeActions(URI, range)
      .find((candidate) => candidate.title.startsWith("Simplify expression"));
    expect(action?.kind).toBe("refactor.rewrite");
    expect(action?.edit?.changes?.[URI]?.[0]).toEqual(expect.objectContaining({ newText: "3" }));
    const data = action?.data as { readonly proof?: { readonly verified?: boolean } } | undefined;
    expect(data?.proof?.verified).toBe(true);
  });

  it("uses the visible declaration context and rejects nondeterministic rewrites", () => {
    const source = "(= (if $c $t $e) override)\n!(if True A B)";
    const analyzer = analyzerFor(source);
    const range = {
      start: { line: 1, character: 3 },
      end: { line: 1, character: 3 },
    };

    expect(analyzer.simplify(URI, range).edits).toStrictEqual([]);
    expect(
      analyzer
        .codeActions(URI, range)
        .some((candidate) => candidate.title.startsWith("Simplify expression")),
    ).toBe(false);
  });

  it("runs semantic deduplication through the analyzer API", () => {
    const analyzer = analyzerFor("!(f $x $x)\n!(f $value $value)");
    const result = analyzer.deduplicate(URI, { minAtoms: 3 });

    expect(result.clones).toEqual([
      expect.objectContaining({ kind: "alpha-equivalent", role: "executable" }),
    ]);
  });
});
