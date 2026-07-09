// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The TS→MeTTa type table mirrors what `@metta-ts/hyperon`'s `jsToAtom` actually grounds a returned host
// value to: number→Number, string→String, boolean→Bool, void/undefined→the unit `(->)`, null→the `null`
// symbol, and every other shape (arrays, objects, functions, bigint) to the opaque `%Undefined%`. Matching
// the runtime is the point: the type we show is the type the value will present as inside MeTTa.

import { describe, expect, it } from "vitest";
import { mettaArrowType, tsTypeToMetta } from "../typeTable.js";

describe("tsTypeToMetta", () => {
  it("maps the grounded primitives", () => {
    expect(tsTypeToMetta("number")).toBe("Number");
    expect(tsTypeToMetta("string")).toBe("String");
    expect(tsTypeToMetta("boolean")).toBe("Bool");
  });

  it("maps void and undefined to the unit type and null to the null symbol", () => {
    expect(tsTypeToMetta("void")).toBe("(->)");
    expect(tsTypeToMetta("undefined")).toBe("(->)");
    expect(tsTypeToMetta("null")).toBe("null");
  });

  it("widens literal types to their grounded base type", () => {
    expect(tsTypeToMetta("3")).toBe("Number");
    expect(tsTypeToMetta("-2.5")).toBe("Number");
    expect(tsTypeToMetta("1e6")).toBe("Number");
    expect(tsTypeToMetta('"hello"')).toBe("String");
    expect(tsTypeToMetta("'hello'")).toBe("String");
    expect(tsTypeToMetta("true")).toBe("Bool");
    expect(tsTypeToMetta("false")).toBe("Bool");
  });

  it("degrades every unmappable shape to %Undefined%", () => {
    expect(tsTypeToMetta("number[]")).toBe("%Undefined%");
    expect(tsTypeToMetta("Array<number>")).toBe("%Undefined%");
    expect(tsTypeToMetta("{ x: number }")).toBe("%Undefined%");
    expect(tsTypeToMetta("(a: number) => number")).toBe("%Undefined%");
    expect(tsTypeToMetta("bigint")).toBe("%Undefined%");
    expect(tsTypeToMetta("string | number")).toBe("%Undefined%");
    expect(tsTypeToMetta("any")).toBe("%Undefined%");
    expect(tsTypeToMetta("unknown")).toBe("%Undefined%");
  });
});

describe("mettaArrowType", () => {
  it("builds a curried arrow with the return type last", () => {
    expect(mettaArrowType(["Number", "Number"], "Number")).toBe("(-> Number Number Number)");
  });

  it("builds a nullary arrow from just the return type", () => {
    expect(mettaArrowType([], "String")).toBe("(-> String)");
  });
});
