// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The version-gated engine's two correctness claims, tested directly on the analyzer:
//   1. Byte-identical: after any sequence of edits, the incrementally-updated analyzer's diagnostics equal a
//      analyzer built from scratch on the same files — on a fixed import graph, so the comparison is valid
//      (adding/removing an imported file leaves an importer's parse-time resolution stale in ANY incremental
//      engine, old or new, so that is out of scope here and covered by the deterministic import tests).
//   2. Fine-grained: an edit to a file outside a document's import closure does not re-run its diagnostics,
//      an edit to a file inside the closure does, and a space mutation re-runs nothing static — observed
//      through the diagnostics-computation counter and the two epochs.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-types";
import { pathToUri } from "../../language-service/index.js";
import { Analyzer, DEFAULT_SETTINGS } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const NAMES = ["lib", "util", "main"] as const;
type Name = (typeof NAMES)[number];

// A fixed import graph: util imports lib, main imports util. Kept constant across every edit so resolution is
// stable and the from-scratch comparison is sound.
const IMPORT_PREFIX: Record<Name, string> = {
  lib: "",
  util: '(import! &self "lib")\n',
  main: '(import! &self "util")\n',
};

// Snippets each file may contain; masks toggle them. They reference cross-file symbols (inc/dec/Color/twice)
// so removing one changes an importer's diagnostics — exactly the cross-file propagation under test.
const POOL: Record<Name, readonly string[]> = {
  lib: [
    "(: inc (-> Number Number))",
    "(= (inc $x) (+ $x 1))",
    "(= (dec $x) (- $x 1))",
    "(: Color Type)",
    "(= (inc $y) (+ $y 9))",
  ],
  util: [
    "(: twice (-> Number Number))",
    "(= (twice $x) (inc (inc $x)))",
    "(= (paint) Color)",
    "(= (broken) (inc))",
  ],
  main: ["!(twice 3)", "!(inc 5)", "!(dec 2)", "(= (go) (twice mysterySymbol))"],
};

const GLOBAL_DUP = { ...DEFAULT_SETTINGS.diagnostics, duplicateDefinitionsMode: "global" as const };

function pathFor(name: Name): string {
  return `/ws/${name}.metta`;
}
function uriFor(name: Name): string {
  return pathToUri(pathFor(name));
}
function contentFor(name: Name, mask: readonly boolean[]): string {
  const chosen = POOL[name].filter((_, index) => mask[index] === true);
  return `${IMPORT_PREFIX[name]}${chosen.join("\n")}\n`;
}
function serialize(diagnostics: readonly Diagnostic[]): string {
  return JSON.stringify(
    diagnostics.map((d) => ({
      message: d.message,
      code: d.code,
      severity: d.severity,
      range: d.range,
    })),
  );
}

// Build an analyzer holding exactly the given file contents (all open, on a shared VFS).
function buildAnalyzer(contents: Record<Name, string>): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  for (const name of NAMES) {
    files.writeFile(pathFor(name), contents[name]);
    analyzer.updateDocument(uriFor(name), contents[name], 1, true);
  }
  return analyzer;
}

const maskArb = (name: Name): fc.Arbitrary<boolean[]> =>
  fc.array(fc.boolean(), { minLength: POOL[name].length, maxLength: POOL[name].length });
const editArb = fc
  .constantFrom<Name>(...NAMES)
  .chain((name) => maskArb(name).map((mask) => ({ name, mask })));

describe("Analyzer engine — differential vs from-scratch", () => {
  it("diagnostics match a from-scratch analyzer after every content edit (global duplicate mode)", () => {
    expect(() =>
      fc.assert(
        fc.property(fc.array(editArb, { minLength: 1, maxLength: 30 }), (edits) => {
          const masks: Record<Name, boolean[]> = {
            lib: POOL.lib.map(() => true),
            util: POOL.util.map(() => true),
            main: POOL.main.map(() => true),
          };
          const contentsOf = (): Record<Name, string> => ({
            lib: contentFor("lib", masks.lib),
            util: contentFor("util", masks.util),
            main: contentFor("main", masks.main),
          });
          const incremental = buildAnalyzer(contentsOf());
          const versions: Record<Name, number> = { lib: 1, util: 1, main: 1 };
          for (const edit of edits) {
            masks[edit.name] = edit.mask;
            versions[edit.name] += 1;
            const content = contentFor(edit.name, edit.mask);
            incremental.updateDocument(uriFor(edit.name), content, versions[edit.name], true);
            const fresh = buildAnalyzer(contentsOf());
            for (const name of NAMES) {
              const incDiags = serialize(incremental.validate(uriFor(name), GLOBAL_DUP));
              const freshDiags = serialize(fresh.validate(uriFor(name), GLOBAL_DUP));
              if (incDiags !== freshDiags) return false;
            }
          }
          return true;
        }),
        { numRuns: 250 },
      ),
    ).not.toThrow();
    // 250 fast-check runs, each building a fresh analyzer per edit and running the interpreter-backed
    // check-types over every file: a thorough differential, legitimately past the 5s default.
  }, 30000);
});

describe("Analyzer engine — fine-grained invalidation", () => {
  it("does not re-run a document's diagnostics when a file outside its closure is edited", () => {
    const files = new InMemoryFileProvider("/ws");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/a.metta", "(= (f $x) (+ $x 1))", 1, true);
    analyzer.updateDocument("file:///ws/b.metta", "(= (g $x) (* $x 2))", 1, true);
    const before = serialize(analyzer.validate("file:///ws/a.metta"));
    const runsAfterFirst = analyzer.diagnosticsComputationCount();

    analyzer.updateDocument("file:///ws/b.metta", "(= (g $x) (* $x 3))", 2, true);
    const after = serialize(analyzer.validate("file:///ws/a.metta"));

    expect(analyzer.diagnosticsComputationCount()).toBe(runsAfterFirst);
    expect(after).toBe(before);
  });

  it("re-runs and updates an importer's diagnostics when the imported file's exports change", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lib.metta", "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))");
    files.writeFile("/ws/main.metta", '(import! &self "lib")\n(= (use $x) (inc $x 99))');
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/lib.metta", files.readFile("/ws/lib.metta") ?? "", 1, true);
    analyzer.updateDocument(
      "file:///ws/main.metta",
      files.readFile("/ws/main.metta") ?? "",
      1,
      true,
    );
    const before = serialize(analyzer.validate("file:///ws/main.metta"));
    const runsAfterFirst = analyzer.diagnosticsComputationCount();

    // Remove inc from lib: main's arity error on `(inc $x 99)` disappears (inc becomes an unknown head,
    // treated as data), so the importer's diagnostics change and are recomputed.
    analyzer.updateDocument("file:///ws/lib.metta", "(: dec (-> Number Number))", 2, true);
    const after = serialize(analyzer.validate("file:///ws/main.metta"));

    expect(analyzer.diagnosticsComputationCount()).toBeGreaterThan(runsAfterFirst);
    expect(after).not.toBe(before);
  });
});

describe("Analyzer engine — file lifecycle", () => {
  it("deleting an imported file invalidates importers and matches from-scratch after re-resolution", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lib.metta", "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))");
    files.writeFile("/ws/main.metta", '(import! &self "lib")\n(= (use $x) (inc $x))');
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/lib.metta", files.readFile("/ws/lib.metta") ?? "", 1, true);
    analyzer.updateDocument(
      "file:///ws/main.metta",
      files.readFile("/ws/main.metta") ?? "",
      1,
      true,
    );
    // While lib is present, the quoted import resolves and `inc` is a known cross-import symbol: no symbol
    // hint is emitted.
    expect(
      analyzer
        .validate("file:///ws/main.metta")
        .filter((d) => String(d.code).startsWith("symbol.")),
    ).toHaveLength(0);

    // Delete lib and refresh import resolution as the watched-files delete handler does.
    analyzer.forgetDocument("file:///ws/lib.metta");
    files.deleteFile("/ws/lib.metta");
    analyzer.refreshImportResolutions();

    const afterDelete = serialize(analyzer.validate("file:///ws/main.metta"));
    // A from-scratch analyzer that never saw lib produces the identical diagnostics.
    const fresh = new Analyzer(new InMemoryFileProvider("/ws"));
    fresh.setWorkspaceRoots(["file:///ws"]);
    fresh.updateDocument(
      "file:///ws/main.metta",
      '(import! &self "lib")\n(= (use $x) (inc $x))',
      1,
      true,
    );
    expect(afterDelete).toBe(serialize(fresh.validate("file:///ws/main.metta")));
    expect(
      analyzer.validate("file:///ws/main.metta").some((d) => d.code === "import.unresolved"),
    ).toBe(true);
  });

  it("resolves an unchanged import after its target is created", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/main.metta", '!(import! &self "lib.metta")\n!(inc 1)');
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(
      "file:///ws/main.metta",
      files.readFile("/ws/main.metta") ?? "",
      1,
      true,
    );
    analyzer.updateDocument("file:///ws/plain.metta", "(= (plain) 1)", 1, true);
    const importerBeforeRefresh = analyzer.getDocument("file:///ws/main.metta");
    const plainBeforeRefresh = analyzer.getDocument("file:///ws/plain.metta");
    expect(
      analyzer.validate("file:///ws/main.metta").some((d) => d.code === "import.unresolved"),
    ).toBe(true);

    files.writeFile("/ws/lib.metta", "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))");
    analyzer.refreshFromDisk("file:///ws/lib.metta");
    analyzer.refreshImportResolutions();

    expect(analyzer.getDocument("file:///ws/main.metta")).not.toBe(importerBeforeRefresh);
    expect(analyzer.getDocument("file:///ws/plain.metta")).toBe(plainBeforeRefresh);
    expect(
      analyzer.validate("file:///ws/main.metta").some((d) => d.code === "import.unresolved"),
    ).toBe(false);
  });
});

describe("Analyzer engine — two-epoch independence", () => {
  it("a space mutation advances only the atomspace epoch and re-runs no static diagnostics", () => {
    const files = new InMemoryFileProvider("/ws");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/a.metta", "(= (f $x) (+ $x 1))", 1, true);
    analyzer.validate("file:///ws/a.metta");

    const syntaxBefore = analyzer.syntaxEpoch();
    const runsBefore = analyzer.diagnosticsComputationCount();
    analyzer.bumpAtomspaceEpoch();
    analyzer.bumpAtomspaceEpoch();
    analyzer.validate("file:///ws/a.metta");

    expect(analyzer.syntaxEpoch()).toBe(syntaxBefore);
    expect(analyzer.atomspaceEpoch()).toBe(2);
    expect(analyzer.diagnosticsComputationCount()).toBe(runsBefore);
  });

  it("retires a runtime answer on either a space mutation or a text edit, independently", () => {
    const files = new InMemoryFileProvider("/ws");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/a.metta", "(= (f $x) (+ $x 1))", 1, true);

    analyzer.cacheRuntimeAnswer("getType", "(f 1)", "Number");
    expect(analyzer.cachedRuntimeAnswer("getType", "(f 1)")).toBe("Number");

    // A space mutation retires it (atomspace epoch moved).
    analyzer.bumpAtomspaceEpoch();
    expect(analyzer.cachedRuntimeAnswer("getType", "(f 1)")).toBeUndefined();

    // Re-cache, then a text edit retires it (syntax epoch moved) with the atomspace epoch untouched.
    analyzer.cacheRuntimeAnswer("getType", "(f 1)", "Number");
    expect(analyzer.cachedRuntimeAnswer("getType", "(f 1)")).toBe("Number");
    analyzer.updateDocument("file:///ws/a.metta", "(= (f $x) (+ $x 2))", 2, true);
    expect(analyzer.cachedRuntimeAnswer("getType", "(f 1)")).toBeUndefined();
  });
});
