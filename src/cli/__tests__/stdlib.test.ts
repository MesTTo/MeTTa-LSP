// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BUILTIN_MODULE_NAMES, builtinModuleSymbols } from "../../server/builtinModules.js";
import { allBuiltinDefinitions, PROLOG_OP_NAMES, PY_OP_NAMES } from "../../server/builtins.js";
import {
  buildStdlibCatalog,
  inspectStdlib,
  renderStdlibInspection,
  renderStdlibList,
  type StdlibCatalog,
  type StdlibEntry,
  type StdlibLookupResult,
  type StdlibModule,
} from "../stdlib.js";

const catalog = buildStdlibCatalog();

function inspected(result: StdlibLookupResult): StdlibEntry | StdlibModule {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function entry(result: StdlibLookupResult): StdlibEntry {
  const value = inspected(result);
  if (value.type !== "entry") throw new Error(`${value.name} is a module`);
  return value;
}

function module(result: StdlibLookupResult): StdlibModule {
  const value = inspected(result);
  if (value.type !== "module") throw new Error(`${value.name} is an entry`);
  return value;
}

describe("stdlib CLI catalog", () => {
  it("contains every global definition exactly once", () => {
    const globals = catalog.entries.filter((item) => item.scope === "global");
    expect(globals).toHaveLength(allBuiltinDefinitions().length);
    expect(new Set(globals.map((item) => item.qualifiedName)).size).toBe(globals.length);
    expect(globals.map((item) => item.name).sort()).toEqual(
      allBuiltinDefinitions()
        .map((def) => def.name)
        .sort(),
    );
  });

  it("contains every builtin module export exactly once", () => {
    expect(catalog.modules.map((item) => item.name)).toEqual([...BUILTIN_MODULE_NAMES].sort());
    expect(catalog.modules.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "combinatorics",
        "datastructures",
        "nars",
        "patrick",
        "pln",
        "roman",
        "spaces",
        "vector",
      ]),
    );
    for (const item of catalog.modules) {
      const expected = [...builtinModuleSymbols(item.name)].sort((left, right) =>
        left.localeCompare(right),
      );
      const actual = catalog.entries
        .filter((candidate) => candidate.module === item.name)
        .map((candidate) => candidate.name)
        .sort((left, right) => left.localeCompare(right));
      expect(actual).toEqual(expected);
      expect(item.exports).toEqual(expected.map((name) => `${item.name}::${name}`));
    }
  });

  it("keeps every qualified name unique", () => {
    const names = catalog.entries.map((item) => item.qualifiedName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("inspects a documented global operator", () => {
    expect(entry(inspectStdlib("+", catalog))).toMatchObject({
      name: "+",
      qualifiedName: "global::+",
      scope: "global",
      category: "core",
      signatures: ["(-> Number Number Number)"],
      description: "Sums two numbers",
      parameters: [
        { type: "Number", description: "Addend" },
        { type: "Number", description: "Augend" },
      ],
      returns: { type: "Number", description: "Sum" },
      documented: true,
    });
  });

  it("falls back to catalog documentation when get-doc has no record", () => {
    const result = entry(inspectStdlib("py-call", catalog));
    expect(result.description).toContain("Call Python");
    expect(result.source).toBe("@metta-ts/py bridge");
    expect(result.category).toBe("host-extension");
    expect(result.documented).toBe(true);
  });

  it("inspects modules and their structured export documentation", () => {
    expect(module(inspectStdlib("json", catalog))).toEqual({
      type: "module",
      name: "json",
      importForm: "!(import! &self json)",
      exports: [
        "json::dict-space",
        "json::get-keys",
        "json::get-value",
        "json::json-decode",
        "json::json-encode",
      ],
    });
    const jsonEncode = entry(inspectStdlib("json::json-encode", catalog));
    expect(jsonEncode).toMatchObject({
      signatures: ["(-> Atom String)"],
      module: "json",
      category: "core",
    });
    expect(jsonEncode.description).toContain("encodes it to json-string");
    expect(entry(inspectStdlib("json-encode", catalog)).qualifiedName).toBe("json::json-encode");
  });

  it("inspects the MeTTa TS importable libraries", () => {
    expect(module(inspectStdlib("vector", catalog)).exports).toEqual(
      expect.arrayContaining(["vector::dot", "vector::random-normal-vector"]),
    );
    const dot = entry(inspectStdlib("vector::dot", catalog));
    expect(dot).toMatchObject({
      signatures: ["(-> Expression Expression Number)"],
      module: "vector",
      category: "core",
    });
    expect(dot.description).toContain("Dot product");
    expect(module(inspectStdlib("nars", catalog)).exports).toContain("nars::Truth_Deduction");
    expect(module(inspectStdlib("pln", catalog)).exports).toContain("pln::Truth_ModusPonens");
  });

  it("preserves overloaded module signatures", () => {
    expect(entry(inspectStdlib("git::git-import!", catalog)).signatures).toEqual([
      "(-> String (->))",
      "GitImportOp",
    ]);
  });

  it("requires qualification when a name has different global and module entries", () => {
    const result = inspectStdlib("transaction", catalog);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "stdlib.ambiguous",
        query: "transaction",
        message: "Standard-library name 'transaction' is ambiguous. Use a qualified name.",
        candidates: ["concurrency::transaction", "global::transaction"],
        suggestions: [],
      },
    });
    expect(entry(inspectStdlib("global::transaction", catalog)).signatures).toEqual([]);
    expect(entry(inspectStdlib("concurrency::transaction", catalog)).signatures).toEqual([
      "(-> Atom %Undefined%)",
    ]);
  });

  it("suggests close names without resolving them", () => {
    const result = inspectStdlib("json-encod", catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("stdlib.unknown");
    expect(result.error.suggestions).toContain("json-encode");
  });

  it.each(["+", "*", "/", "->"])("resolves punctuation name %s", (name) => {
    expect(entry(inspectStdlib(name, catalog)).name).toBe(name);
  });

  it("renders deterministic list and detail views", () => {
    const list = renderStdlibList(catalog);
    expect(list).toBe(renderStdlibList(catalog));
    expect(list).toContain("Core global entries");
    expect(list).toContain("Host bridge extensions");
    const plus = entry(inspectStdlib("+", catalog));
    const rendered = renderStdlibInspection(plus);
    expect(renderStdlibInspection(plus)).toBe(rendered);
    expect(rendered).toContain("Sums two numbers");
    expect(rendered).toContain("Returns: Number: Sum");
  });

  it("round-trips every qualified entry through exact lookup", () => {
    const qualifiedNames = catalog.entries.map((item) => item.qualifiedName);
    fc.assert(
      fc.property(fc.constantFrom(...qualifiedNames), (qualifiedName) => {
        expect(entry(inspectStdlib(qualifiedName, catalog)).qualifiedName).toBe(qualifiedName);
      }),
      { numRuns: Math.max(qualifiedNames.length, 300) },
    );
  });

  it("keeps catalog counts internally consistent", () => {
    const checked: StdlibCatalog = catalog;
    expect(checked.counts.entries).toBe(checked.entries.length);
    expect(checked.counts.globalEntries + checked.counts.moduleEntries).toBe(
      checked.counts.entries,
    );
    expect(
      checked.counts.coreGlobalEntries +
        checked.counts.lspExtensionEntries +
        checked.counts.hostExtensionEntries,
    ).toBe(checked.counts.globalEntries);
    expect(checked.counts.lspExtensionEntries).toBe(1);
    expect(checked.counts.hostExtensionEntries).toBe(PY_OP_NAMES.size + PROLOG_OP_NAMES.size);
    expect(checked.counts.documentedEntries).toBe(
      checked.entries.filter((item) => item.documented).length,
    );
  });
});
