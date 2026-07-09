// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The docs-URL projection: builtins and catalogued diagnostic codes map to stable URLs under the base,
// an empty base turns links off, and only catalogued codes get a link (never a 404).

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allBuiltinDefinitions } from "../builtins.js";
import {
  anchor,
  builtinDocsUrl,
  DOCUMENTED_DIAGNOSTIC_CODES,
  diagnosticDocsUrl,
} from "../docsLinks.js";

const BASE = "https://docs.example/metta";

describe("builtinDocsUrl", () => {
  it("links a named builtin to its anchor on the reference page", () => {
    expect(builtinDocsUrl(BASE, "py-atom")).toBe(`${BASE}/reference/builtins#py-atom`);
    expect(builtinDocsUrl(BASE, "if")).toBe(`${BASE}/reference/builtins#if`);
  });

  it("links every punctuation builtin to its own anchor", () => {
    expect(builtinDocsUrl(BASE, "+")).toBe(`${BASE}/reference/builtins#_2b_`);
    expect(builtinDocsUrl(BASE, "->")).toBe(`${BASE}/reference/builtins#-_3e_`);
  });

  it("tolerates a trailing slash on the base", () => {
    expect(builtinDocsUrl(`${BASE}/`, "match")).toBe(`${BASE}/reference/builtins#match`);
  });

  it("keeps names distinct after readable-slug normalization", () => {
    const names = ["a b", "a-b", "A-b", "include", "include!", "with-mutex", "with_mutex"];
    expect(new Set(names.map(anchor))).toHaveLength(names.length);
  });

  it("gives every catalog builtin a unique non-empty anchor", () => {
    const anchors = new Map<string, string[]>();
    for (const builtin of allBuiltinDefinitions()) {
      const id = anchor(builtin.name);
      expect(id).not.toBe("");
      anchors.set(id, [...(anchors.get(id) ?? []), builtin.name]);
    }
    const collisions = [...anchors.values()].filter((names) => names.length > 1);
    expect(collisions).toStrictEqual([]);
  });

  it("maps arbitrary distinct names to distinct non-empty anchors", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (left, right) => {
        expect(anchor(left)).not.toBe("");
        expect(anchor(right)).not.toBe("");
        expect(anchor(left) === anchor(right)).toBe(left === right);
      }),
      { numRuns: 500 },
    );
    expect(anchor("with_mutex")).toBe("with_5f_mutex");
    expect(anchor("lambda-λ")).toBe("lambda-_3bb_");
    expect(anchor("")).toBe("_empty_");
  });

  it("returns null when the base is empty", () => {
    expect(builtinDocsUrl("", "if")).toBeNull();
  });
});

describe("diagnosticDocsUrl", () => {
  it("links a catalogued code to its diagnostics page", () => {
    expect(diagnosticDocsUrl(BASE, "import.notRun")).toBe(`${BASE}/diagnostics/import.notRun`);
    expect(diagnosticDocsUrl(BASE, "symbol.possibleTypo")).toBe(
      `${BASE}/diagnostics/symbol.possibleTypo`,
    );
  });

  it("returns null for an uncatalogued code, an undefined code, or an empty base", () => {
    expect(diagnosticDocsUrl(BASE, "not.a.real.code")).toBeNull();
    expect(diagnosticDocsUrl(BASE, undefined)).toBeNull();
    expect(diagnosticDocsUrl("", "symbol.possibleTypo")).toBeNull();
  });

  it("catalogues exactly the analyzer's own semantic codes", () => {
    expect([...DOCUMENTED_DIAGNOSTIC_CODES].sort()).toStrictEqual(
      [
        "call.arity",
        "call.typeMismatch",
        "definition.duplicate",
        "import.notRun",
        "import.unresolved",
        "space.unbound",
        "symbol.needsImport",
        "symbol.possibleTypo",
        "type.undefined",
        "variable.reservedHash",
        "variable.suspiciousSemicolon",
        "variable.undefined",
      ].sort(),
    );
  });
});
