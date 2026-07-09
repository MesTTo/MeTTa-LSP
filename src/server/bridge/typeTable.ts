// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Map a TypeScript type (as `checker.typeToString` renders it) to the MeTTa type its grounded value
// presents as. The table follows `@metta-ts/hyperon`'s `jsToAtom`: only `number`/`string`/`boolean` ground
// to first-class MeTTa values (Number/String/Bool); `void`/`undefined` are the unit `(->)`; `null` is the
// `null` symbol; everything else (arrays, objects, functions, bigint, unions) is wrapped opaquely and reads
// as `%Undefined%`, the "type unknown" escape hatch. The bridge shows the type a host value WILL have in
// MeTTa, so matching the runtime grounding is the whole point.

// The MeTTa "type unknown" atom. An unmappable host type degrades to this rather than guessing.
export const METTA_UNKNOWN = "%Undefined%";

// A TS number literal type as `typeToString` renders it: an optional sign, integer digits, an optional
// fractional part, and an optional exponent. Anchored and linear (no nested quantifiers over the same class).
const NUMERIC_LITERAL = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function isStringLiteral(t: string): boolean {
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
}

export function tsTypeToMetta(tsType: string): string {
  const t = tsType.trim();
  switch (t) {
    case "number":
      return "Number";
    case "string":
      return "String";
    case "boolean":
    case "true":
    case "false":
      return "Bool";
    case "void":
    case "undefined":
      return "(->)";
    case "null":
      return "null";
    default:
      break;
  }
  if (isStringLiteral(t)) return "String";
  if (NUMERIC_LITERAL.test(t)) return "Number";
  return METTA_UNKNOWN;
}

// A MeTTa function type from mapped parameter types and a mapped return type: the return comes last, e.g.
// `(-> Number Number Number)` for `(a: number, b: number) => number`.
export function mettaArrowType(params: readonly string[], returns: string): string {
  return `(-> ${[...params, returns].join(" ")})`;
}
