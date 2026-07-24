// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// importGraphFromSources is what every evaluation worker feeds the runtime as its import map. It must resolve
// the same graph @metta-ts/node's readImports builds from the filesystem, transitive edges included: a module
// the entry imports may itself `import!` a third module, and the runtime only follows that edge when the entry
// keeps its ImportModule structure. Converting each module to a flat Atom[] dropped those edges, so an
// imported multi-file suite ran against unresolved cross-file helpers and every such assert failed.

import * as core from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { importGraphFromSources } from "../workerShared.js";

const BASE = "(= (base-helper $x) (+ $x 100))";
const LIB = "!(import! &self base)\n(= (lib-helper $x) (base-helper $x))";
const MAIN = "!(import! &self lib)\n!(assertEqual (lib-helper 5) 105)";

// The results of the program's last bang query, which in these fixtures is the assertion. A passing assert
// reduces to unit; an unresolved helper leaves an (Error … results-are-not-equal) atom instead.
function assertionResult(source: string, sources: Record<string, string>): string[] {
  const imports = importGraphFromSources(core, source, sources);
  const queries = core.runProgram(source, 20_000, imports, { maxStackDepth: 512 });
  return (queries[queries.length - 1]?.results ?? []).map((atom) => core.format(atom));
}

describe("importGraphFromSources", () => {
  it("resolves a helper reached only through an imported module's own import", () => {
    // main -> lib -> base. `base-helper` is never named by main, so it resolves only if lib's edge is followed.
    expect(assertionResult(MAIN, { lib: LIB, base: BASE })).toEqual(["()"]);
  });

  it("keeps the transitive module's import edges rather than flattening it to atoms", () => {
    const imports = importGraphFromSources(core, MAIN, { lib: LIB, base: BASE });
    const lib = imports.get("lib");
    expect(Array.isArray(lib)).toBe(false);
    expect((lib as core.ImportModule).imports.length).toBeGreaterThan(0);
  });

  it("resolves a directly imported helper", () => {
    const main = "!(import! &self base)\n!(assertEqual (base-helper 5) 105)";
    expect(assertionResult(main, { base: BASE })).toEqual(["()"]);
  });

  it("leaves an unknown module unresolved instead of throwing", () => {
    expect(() => importGraphFromSources(core, "!(import! &self missing)", {})).not.toThrow();
  });
});
