// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Shared fast-check generators for random MeTTa programs, plus core's canonical-forms fingerprint. The
// fingerprint is the sequence of atoms the interpreter actually reads (each printed via core's `format`), so
// two sources with the same fingerprint mean the same program regardless of whitespace or comments. Tests use
// it to assert a transformation preserves the program: the parser round-trip (differential test) and the
// formatter (`canonicalForms(format(src)) === canonicalForms(src)`).

import { format, parseAll, standardTokenizer, type TopAtom } from "@metta-ts/core";
import fc from "fast-check";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const SYMBOL_TAIL = `${LETTERS}0123456789-_`;

export const symbolArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...LETTERS.split("")),
    fc.array(fc.constantFrom(...SYMBOL_TAIL.split("")), { maxLength: 5 }),
  )
  .map(([head, tail]) => head + tail.join(""));

export const variableArb: fc.Arbitrary<string> = symbolArb.map((name) => `$${name}`);
export const numberArb: fc.Arbitrary<string> = fc.integer({ min: -999, max: 9999 }).map(String);
// String literals kept to letters and spaces so no escape sequence enters the generated source.
export const stringArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...`${LETTERS} `.split("")), { maxLength: 6 })
  .map((chars) => `"${chars.join("")}"`);

// A rendered MeTTa form of bounded nesting depth: a symbol, a variable, or a parenthesised list. This is the
// generator the parser differential test relies on, so it stays limited to what that oracle compares.
export function formArb(depth: number): fc.Arbitrary<string> {
  const leaf = fc.oneof(symbolArb, variableArb);
  if (depth <= 0) return leaf;
  return fc.oneof(
    leaf,
    fc.array(formArb(depth - 1), { maxLength: 4 }).map((items) => `(${items.join(" ")})`),
  );
}

export const programArb: fc.Arbitrary<string> = fc
  .array(formArb(3), { maxLength: 5 })
  .map((forms) => forms.join("\n"));

// Heads that drive the formatter's semantic layouts (symmetric align, body indent), so the fuzz corpus
// actually exercises those paths rather than only bare lists.
const KNOWN_HEADS = [
  "=",
  "if",
  "and",
  "or",
  "let",
  "let*",
  "match",
  "chain",
  ":",
  "case",
  "+",
  "->",
];

// A richer form for stressing the formatter: leaves also include numbers and strings, and lists are
// sometimes headed by a known form so align/block layouts fire.
export function richFormArb(depth: number): fc.Arbitrary<string> {
  const leaf = fc.oneof(symbolArb, variableArb, numberArb, stringArb);
  if (depth <= 0) return leaf;
  const list = fc
    .array(richFormArb(depth - 1), { maxLength: 4 })
    .map((items) => `(${items.join(" ")})`);
  const knownForm = fc
    .tuple(
      fc.constantFrom(...KNOWN_HEADS),
      fc.array(richFormArb(depth - 1), { minLength: 1, maxLength: 4 }),
    )
    .map(([head, args]) => `(${head} ${args.join(" ")})`);
  return fc.oneof(leaf, list, knownForm);
}

export const richProgramArb: fc.Arbitrary<string> = fc
  .array(richFormArb(3), { maxLength: 5 })
  .map((forms) => forms.join("\n"));

const commentArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...LETTERS.split("")), { minLength: 1, maxLength: 6 })
  .map((chars) => `; ${chars.join("")}`);

// Programs with line comments attached before and after forms, to fuzz comment attachment and the layout
// stability that depends on it (a leading comment must never migrate onto the head line).
export const commentedProgramArb: fc.Arbitrary<string> = fc
  .array(
    fc.tuple(
      fc.option(commentArb, { nil: undefined }),
      richFormArb(3),
      fc.option(commentArb, { nil: undefined }),
    ),
    { maxLength: 5 },
  )
  .map((entries) =>
    entries
      .map(
        ([lead, form, trail]) =>
          `${lead === undefined ? "" : `${lead}\n`}${form}${trail === undefined ? "" : ` ${trail}`}`,
      )
      .join("\n"),
  );

const tk = standardTokenizer();

// The atoms the interpreter reads from `src`, each printed canonically. Comments and whitespace do not
// appear, so this is invariant under formatting and is the oracle for "same program".
export function canonicalForms(src: string): string[] {
  return parseAll(src, tk).map((top: TopAtom) => `${top.bang ? "!" : ""}${format(top.atom)}`);
}
