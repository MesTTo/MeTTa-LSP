// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { simplifyExpression, verifySimplificationProof } from "../simplify.js";

describe("simplification properties", () => {
  it("produces replayable, idempotent ground arithmetic simplifications", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.integer({ min: -10_000, max: 10_000 }),
        fc.constantFrom("+", "-", "*"),
        (left, right, operator) => {
          const result = simplifyExpression(`(${operator} ${left} ${right})`);
          expect(result).not.toBeNull();
          expect(verifySimplificationProof(result!.proof)).toBe(true);
          expect(simplifyExpression(result!.after)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
