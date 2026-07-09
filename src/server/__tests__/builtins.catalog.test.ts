// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The builtin catalog is derived from @metta-ts/core at module load, so it covers exactly the running
// system's builtins and its signatures never drift from the interpreter's own type declarations. These
// checks are the guard: the catalog stays complete (every declared type and grounded op is present) and
// honest (a derived entry's signature is the interpreter's, verbatim). Built-in module functions stay out of
// the global catalog on purpose; they are import-gated, covered by analyzer.modules.test.ts.

import { pettaOpNames } from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { coreBuiltinTypes } from "../../language-service/index.js";
import {
  BUILTIN_BY_NAME,
  BUILTINS,
  LSP_INTERNAL_CORE_OPS,
  METTA_ARITHMETIC_OPERATORS,
  METTA_ASSERTION_FORMS,
  METTA_BINDING_FORMS,
  METTA_COLLECTION_FUNCTIONS,
  METTA_COMPARISON_OPERATORS,
  METTA_CONTROL_FLOW_FORMS,
  METTA_EFFECT_FORMS,
  METTA_EVALUATION_FORMS,
  METTA_LOGICAL_OPERATORS,
  METTA_MATH_FUNCTIONS,
  METTA_MODULE_FORMS,
  METTA_PATTERN_FORMS,
  METTA_PREDICATE_FUNCTIONS,
  METTA_QUOTE_FORMS,
  METTA_TYPE_FORMS,
  OPERATORS,
  SPECIAL_FORMS,
} from "../builtins.js";

const DERIVED_SOURCE = "@metta-ts/core (interpreter-derived)";

describe("interpreter-derived builtin catalog", () => {
  it("covers every builtin the interpreter declares a type for, except LSP-internal ops", () => {
    const missing = [...coreBuiltinTypes().keys()].filter(
      (name) => !BUILTIN_BY_NAME.has(name) && !LSP_INTERNAL_CORE_OPS.has(name),
    );
    expect(missing).toStrictEqual([]);
    // check-types is added to core for the LSP's diagnostics but deliberately kept out of the catalog.
    expect(LSP_INTERNAL_CORE_OPS.has("check-types")).toBe(true);
    expect(BUILTIN_BY_NAME.has("check-types")).toBe(false);
  });

  it("covers every grounded operation the interpreter registers", () => {
    const missing = [...pettaOpNames].filter((name) => !BUILTIN_BY_NAME.has(name));
    expect(missing).toStrictEqual([]);
  });

  it("gives each interpreter-derived entry the interpreter's own signature, verbatim", () => {
    const types = coreBuiltinTypes();
    const drift: string[] = [];
    for (const builtin of BUILTINS) {
      if (builtin.source !== DERIVED_SOURCE) continue;
      const declared = types.get(builtin.name);
      if (declared === undefined) continue; // a grounded op with no type declaration has no signature
      if (builtin.signatures[0] !== declared.type)
        drift.push(`${builtin.name}: ${builtin.signatures[0]} vs core ${declared.type}`);
    }
    expect(drift).toStrictEqual([]);
  });

  it("does not expose built-in module functions as always-on globals", () => {
    for (const name of ["json-encode", "json-decode", "file-open!", "catalog-list!", "dict-space"])
      expect(BUILTIN_BY_NAME.has(name)).toBe(false);
  });

  it("is far larger than the hand-maintained LSP-only set it replaced", () => {
    expect(BUILTINS.length).toBeGreaterThan(200);
  });

  it("keeps explicit overlays scoped to implemented syntax, prelude rules, and registered bridges", () => {
    expect(BUILTIN_BY_NAME.get("!")?.source).toBe("@metta-ts/core syntax");
    expect(BUILTIN_BY_NAME.get("include!")?.source).toBe("MeTTa LSP import alias");
    expect(BUILTIN_BY_NAME.get("unquote")?.source).toBe("@metta-ts/core prelude (untyped overlay)");
    expect(BUILTIN_BY_NAME.get("nop")?.source).toBe("@metta-ts/core prelude (untyped overlay)");
    expect(BUILTIN_BY_NAME.get("py-dict")?.source).toBe("@metta-ts/py bridge");
    expect(BUILTIN_BY_NAME.has("sequential")).toBe(false);
    expect(BUILTIN_BY_NAME.has("print")).toBe(false);
    expect(BUILTIN_BY_NAME.has("!=")).toBe(false);
  });

  it("keeps semantic token groups tied to known stdlib, operator, or special-form symbols", () => {
    const known = new Set([...BUILTIN_BY_NAME.keys(), ...SPECIAL_FORMS, ...OPERATORS]);
    const groups: Readonly<Record<string, ReadonlySet<string>>> = {
      METTA_CONTROL_FLOW_FORMS,
      METTA_BINDING_FORMS,
      METTA_PATTERN_FORMS,
      METTA_MODULE_FORMS,
      METTA_TYPE_FORMS,
      METTA_EVALUATION_FORMS,
      METTA_QUOTE_FORMS,
      METTA_EFFECT_FORMS,
      METTA_ARITHMETIC_OPERATORS,
      METTA_COMPARISON_OPERATORS,
      METTA_LOGICAL_OPERATORS,
      METTA_MATH_FUNCTIONS,
      METTA_COLLECTION_FUNCTIONS,
      METTA_PREDICATE_FUNCTIONS,
      METTA_ASSERTION_FORMS,
    };
    const unknown: string[] = [];
    for (const [group, names] of Object.entries(groups)) {
      for (const name of names) {
        if (!known.has(name)) unknown.push(`${group}:${name}`);
      }
    }
    expect(unknown).toStrictEqual([]);
  });
});
