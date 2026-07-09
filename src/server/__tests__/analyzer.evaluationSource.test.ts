// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// evaluationSource composes what Run executes: the selection bang-wrapped when bare, prefixed by the
// prior definitions, type declarations, and banged directives it needs to mean what it means in the
// file. The core round-trip tests prove the composed source actually evaluates — they exercise the real
// pipeline (index → composition → @metta-ts/core with the workspace import map), not a lookalike.

import { type Atom, format, parseAll, runProgram, standardTokenizer } from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const LIB = "(= (helper $x) (+ $x 1))";

function analyzerFor(main: string): { analyzer: Analyzer; uri: string } {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/lib.metta", LIB);
  files.writeFile("/ws/main.metta", main);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  const uri = "file:///ws/main.metta";
  analyzer.updateDocument("file:///ws/lib.metta", LIB, 1, true);
  analyzer.updateDocument(uri, main, 1, true);
  return { analyzer, uri };
}

// The worker's exact imports conversion (evaluationWorker.ts): module name → parsed Atom[].
function importsAsAtoms(map: Record<string, string>): Map<string, Atom[]> {
  const converted = new Map<string, Atom[]>();
  for (const [name, source] of Object.entries(map)) {
    converted.set(
      name,
      parseAll(source, standardTokenizer()).map((top) => top.atom),
    );
  }
  return converted;
}

function results(source: string, imports: Map<string, Atom[]>): string[] {
  return runProgram(source, 20_000, imports, { maxStackDepth: 512 }).flatMap((query) =>
    query.results.map((atom) => format(atom)),
  );
}

describe("evaluationSource — the source Run composes for a range", () => {
  const main = "!(import! &self lib)\n(= (compute $n) (helper (* $n 2)))\n(compute 5)";
  const callRange = { start: { line: 2, character: 0 }, end: { line: 2, character: 11 } };

  it("bang-wraps a bare selection and prepends defs and banged directives as written", () => {
    const { analyzer, uri } = analyzerFor(main);
    expect(analyzer.evaluationSource(uri, callRange)).toBe(
      "!(import! &self lib)\n(= (compute $n) (helper (* $n 2)))\n!(compute 5)",
    );
  });

  it("evaluates to real results through core with the workspace import map", () => {
    const { analyzer, uri } = analyzerFor(main);
    const source = analyzer.evaluationSource(uri, callRange);
    const imports = importsAsAtoms(analyzer.importSourceMap(uri));
    expect(results(source, imports)).toContain("11");
  });

  it("evaluates quoted import paths through the workspace import map", () => {
    // @metta-ts/core 1.1.1 resolves quoted file paths through the injected import map, so editor Run and the
    // CLI can execute the same file path form users write for navigation.
    const quoted = '!(import! &self "lib.metta")\n(= (compute $n) (helper (* $n 2)))\n(compute 5)';
    const { analyzer, uri } = analyzerFor(quoted);
    const source = analyzer.evaluationSource(uri, callRange);
    const imports = importsAsAtoms(analyzer.importSourceMap(uri));
    expect(results(source, imports)).toContain("11");
  });

  it("keeps a selected definition unwrapped", () => {
    const { analyzer, uri } = analyzerFor(main);
    const source = analyzer.evaluationSource(uri, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 34 },
    });
    expect(source).toBe("!(import! &self lib)\n(= (compute $n) (helper (* $n 2)))");
  });

  it("prepends a pragma! so a range run obeys the file's settings", () => {
    const src = "!(pragma! tabling False)\n(= (f $x) $x)\n(f 1)";
    const { analyzer, uri } = analyzerFor(src);
    const source = analyzer.evaluationSource(uri, {
      start: { line: 2, character: 0 },
      end: { line: 2, character: 5 },
    });
    expect(source).toBe("!(pragma! tabling False)\n(= (f $x) $x)\n!(f 1)");
  });

  it("returns the whole file untouched without a range", () => {
    const { analyzer, uri } = analyzerFor(main);
    expect(analyzer.evaluationSource(uri)).toBe(main);
  });
});

describe("executableQuery — the query visualise reduces with no prompt", () => {
  it("takes the file's last bang query without its bang", () => {
    const { analyzer, uri } = analyzerFor("(= (f $x) $x)\n!(f 1)\n!(f 2)");
    expect(analyzer.executableQuery(uri)).toBe("(f 2)");
  });

  it("falls back to the trailing bare call", () => {
    const { analyzer, uri } = analyzerFor(
      "!(import! &self lib)\n(= (compute $n) (helper (* $n 2)))\n(compute 5)",
    );
    expect(analyzer.executableQuery(uri)).toBe("(compute 5)");
  });

  it("reads a fused bang query", () => {
    const { analyzer, uri } = analyzerFor("(= (f) 1)\n!42");
    expect(analyzer.executableQuery(uri)).toBe("42");
  });

  it("returns null when the file only defines", () => {
    const { analyzer, uri } = analyzerFor("(= (f $x) $x)\n(: f (-> Number Number))");
    expect(analyzer.executableQuery(uri)).toBeNull();
  });
});
