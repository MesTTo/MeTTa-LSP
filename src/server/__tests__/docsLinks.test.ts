// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The docs-URL projection: builtins and catalogued diagnostic codes map to stable URLs under the base,
// an empty base turns links off, and only catalogued codes get a link (never a 404).

import { describe, expect, it } from "vitest";
import { allBuiltinDefinitions } from "../builtins.js";
import { builtinDocsUrl, DOCUMENTED_DIAGNOSTIC_CODES, diagnosticDocsUrl } from "../docsLinks.js";

const BASE = "https://docs.example/metta";

describe("builtinDocsUrl", () => {
  it("links a named builtin to its anchor on the reference page", () => {
    expect(builtinDocsUrl(BASE, "py-atom")).toBe(`${BASE}/reference/builtins#py-atom`);
    expect(builtinDocsUrl(BASE, "get-type")).toBe(`${BASE}/reference/builtins#get-type`);
    expect(builtinDocsUrl(BASE, "if")).toBe(`${BASE}/reference/builtins#if`);
  });

  it("links a punctuation builtin to the page without an anchor", () => {
    expect(builtinDocsUrl(BASE, "+")).toBe(`${BASE}/reference/builtins`);
    expect(builtinDocsUrl(BASE, "->")).toBe(`${BASE}/reference/builtins`);
  });

  it("tolerates a trailing slash on the base", () => {
    expect(builtinDocsUrl(`${BASE}/`, "match")).toBe(`${BASE}/reference/builtins#match`);
  });

  it("keeps names distinct when they differ only by trailing punctuation", () => {
    // include vs include! and let vs let* must not collapse to the same anchor, or the docs site cannot
    // give each its own heading.
    expect(builtinDocsUrl(BASE, "include")).toBe(`${BASE}/reference/builtins#include`);
    expect(builtinDocsUrl(BASE, "include!")).toBe(`${BASE}/reference/builtins#include-`);
    expect(builtinDocsUrl(BASE, "let")).toBe(`${BASE}/reference/builtins#let`);
    expect(builtinDocsUrl(BASE, "let*")).toBe(`${BASE}/reference/builtins#let-`);
  });

  it("keeps dashed and underscored spellings distinct", () => {
    expect(builtinDocsUrl(BASE, "with-mutex")).toBe(`${BASE}/reference/builtins#with-mutex`);
    expect(builtinDocsUrl(BASE, "with_mutex")).toBe(`${BASE}/reference/builtins#with_mutex`);
  });

  it("keeps case-distinct builtins distinct", () => {
    expect(builtinDocsUrl(BASE, "Empty")).toBe(`${BASE}/reference/builtins#Empty`);
    expect(builtinDocsUrl(BASE, "empty")).toBe(`${BASE}/reference/builtins#empty`);
  });

  it("gives every builtin a unique non-empty anchor (so the reference page ids do not collide)", () => {
    const anchors = new Map<string, string[]>();
    for (const builtin of allBuiltinDefinitions()) {
      const url = builtinDocsUrl(BASE, builtin.name);
      const hash = url?.indexOf("#") ?? -1;
      if (url === null || hash === -1) continue;
      const anchor = url.slice(hash + 1);
      anchors.set(anchor, [...(anchors.get(anchor) ?? []), builtin.name]);
    }
    const collisions = [...anchors.values()].filter((names) => names.length > 1);
    expect(collisions).toStrictEqual([]);
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
