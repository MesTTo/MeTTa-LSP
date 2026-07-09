// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Property/fuzz tests for the formatter, the hard invariants the spec requires. Over thousands of random
// programs (bare lists, known-head forms, and forms carrying line comments) the formatter must:
//   1. preserve the program: the atoms core reads from the formatted output equal the atoms it read from the
//      input (formatting changes layout, never meaning);
//   2. be idempotent: format(format(x)) === format(x);
//   3. never introduce a syntax error: formatted clean source still parses clean.

import { parseCst, standardTokenizer } from "@metta-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalForms,
  commentedProgramArb,
  programArb,
  richProgramArb,
} from "../../__fixtures__/mettaProgramArb.js";
import { formatMetta } from "../formatMetta.js";

const tk = standardTokenizer();
const parsesClean = (src: string): boolean => parseCst(src, tk).diagnostics.length === 0;
const anyProgramArb = fc.oneof(programArb, richProgramArb, commentedProgramArb);

describe("formatMetta properties", () => {
  it("preserves the atoms core reads (format changes layout, not meaning)", () => {
    fc.assert(
      fc.property(anyProgramArb, (src) => {
        expect(parsesClean(src)).toBe(true);
        expect(canonicalForms(formatMetta(src))).toStrictEqual(canonicalForms(src));
      }),
      { numRuns: 1000 },
    );
  });

  it("is idempotent: format(format(x)) === format(x)", () => {
    fc.assert(
      fc.property(anyProgramArb, (src) => {
        const once = formatMetta(src);
        expect(formatMetta(once)).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });

  it("never turns clean source into a syntax error", () => {
    fc.assert(
      fc.property(anyProgramArb, (src) => {
        expect(parsesClean(src)).toBe(true);
        expect(parsesClean(formatMetta(src))).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("never throws on arbitrary text", () => {
    fc.assert(
      fc.property(fc.string(), (src) => {
        expect(() => formatMetta(src)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
});
