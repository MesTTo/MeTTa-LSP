// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deduplicate } from "../deduplicate.js";

describe("deduplicate properties", () => {
  it("is invariant under a consistent variable renaming", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u),
        fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/u),
        (left, right) => {
          fc.pre(left !== right);
          const result = deduplicate(
            [
              {
                uri: "file:///main.metta",
                text: `(= (f $${left}) (pair $${left} $${left}))\n(= (f $${right}) (pair $${right} $${right}))`,
              },
            ],
            { minAtoms: 4 },
          );
          expect(
            result.clones.some(
              (clone) =>
                clone.kind === "alpha-equivalent" &&
                clone.occurrences.every((item) => item.role === "declaration"),
            ),
          ).toBe(true);
        },
      ),
    );
  });
});
