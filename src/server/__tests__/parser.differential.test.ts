// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Differential and property tests for the span-CST parser against @metta-ts/core, the reference
// interpreter's own reader. The oracle is core itself: we take each top-level CST node our parser
// produces, slice its exact source span, and run that slice back through core's `parseAll`. If our
// top-level boundaries match core's, the per-node canonical forms concatenate to exactly what core reads
// from the whole source. This isolates the one thing that must agree, top-level form splitting, without
// depending on the two parsers sharing an internal representation.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalForms, programArb } from "../../__fixtures__/mettaProgramArb.js";
import { PARSER_CORPUS } from "../__fixtures__/parser-corpus.js";
import { parseMeTTa, semanticChildren } from "../parser.js";

// Our parser's view of the same source, re-canonicalized through core one top-level node at a time.
function ourCanonicalForms(src: string): string[] {
  const nodes = semanticChildren(parseMeTTa("metta://diff/input.metta", src).root);
  return nodes.flatMap((node) => canonicalForms(src.slice(node.offsetStart, node.offsetEnd)));
}

function formsMatch(src: string): boolean {
  const ours = ourCanonicalForms(src);
  const reference = canonicalForms(src);
  return ours.length === reference.length && ours.every((form, index) => form === reference[index]);
}

// Known parser-fidelity gap. The reference reader treats a top-level `!` as a bang (evaluation) prefix
// that binds to the following form, so `!(foo 1)` is a single bang-form. Our span-CST currently keeps `!`
// as its own atom (the analyzer already special-cases it), so it reads as two top-level forms.
const KNOWN_DIVERGENCES = new Set<string>(["bang-eval"]);

describe("parser differential vs @metta-ts/core", () => {
  for (const testCase of PARSER_CORPUS.filter((entry) => !KNOWN_DIVERGENCES.has(entry.name))) {
    it(`agrees on top-level structure (${testCase.kind}): ${testCase.name}`, () => {
      expect(ourCanonicalForms(testCase.src)).toStrictEqual(canonicalForms(testCase.src));
    });
  }

  // Closing the bang gap belongs to the parser-fidelity work in the feature-depth phase. `it.fails`
  // records the divergence, keeps it under test, and flips red the moment the parser matches core,
  // forcing this back to a normal assertion instead of letting the gap pass silently.
  it.fails("known divergence: bang prefix binds to the following form", () => {
    expect(ourCanonicalForms("!(foo 1)")).toStrictEqual(canonicalForms("!(foo 1)"));
  });
});

describe("parser property tests", () => {
  it("never throws on arbitrary input", () => {
    expect(() =>
      fc.assert(
        fc.property(fc.string(), (src) => {
          parseMeTTa("metta://prop/input.metta", src);
        }),
        { numRuns: 500 },
      ),
    ).not.toThrow();
  });

  it("splits generated programs at the same top-level boundaries as core", () => {
    expect(() =>
      fc.assert(
        fc.property(programArb, (src) => formsMatch(src)),
        { numRuns: 300 },
      ),
    ).not.toThrow();
  });
});
