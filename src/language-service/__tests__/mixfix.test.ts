// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The mixfix renderer turns a MeTTa S-expression into readable infix/keyword notation, parenthesising only
// where precedence or associativity would otherwise misgroup a reader.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { richFormArb } from "../../__fixtures__/mettaProgramArb.js";
import { toMixfix } from "../mixfix.js";

describe("toMixfix", () => {
  it("renders arithmetic infix with standard precedence", () => {
    expect(toMixfix("(+ (* a b) c)")).toBe("a * b + c");
    expect(toMixfix("(* (+ a b) c)")).toBe("(a + b) * c");
    expect(toMixfix("(- a (- b c))")).toBe("a - (b - c)");
  });

  it("renders comparison and logic with and binding tighter than or", () => {
    expect(toMixfix("(== a b)")).toBe("a == b");
    expect(toMixfix("(or a (and b c))")).toBe("a or b and c");
    expect(toMixfix("(and (or a b) c)")).toBe("(a or b) and c");
    expect(toMixfix("(not (== a b))")).toBe("not (a == b)");
  });

  it("renders the keyword forms", () => {
    expect(toMixfix("(if c a b)")).toBe("if c then a else b");
    expect(toMixfix("(if c a)")).toBe("if c then a");
    expect(toMixfix("(let $x 5 (+ $x 1))")).toBe("let $x = 5 in $x + 1");
    expect(toMixfix("(match &self ($k $v) $v)")).toBe("match &self with ($k $v) => $v");
  });

  it("nests a keyword form inside an operator with parentheses", () => {
    expect(toMixfix("(+ (if c 1 2) 3)")).toBe("(if c then 1 else 2) + 3");
  });

  it("renders a curried function type right-associatively", () => {
    expect(toMixfix("(-> Number Number)")).toBe("Number -> Number");
    expect(toMixfix("(-> A B C)")).toBe("A -> B -> C");
    expect(toMixfix("(-> (-> A B) C)")).toBe("(A -> B) -> C");
    expect(toMixfix("(: inc (-> Number Number))")).toBe("inc : Number -> Number");
  });

  it("renders a rule definition and application", () => {
    expect(toMixfix("(= (inc $x) (+ $x 1))")).toBe("inc($x) = $x + 1");
    expect(toMixfix("(f x y)")).toBe("f(x, y)");
    expect(toMixfix("(Cons 1 (Cons 2 Nil))")).toBe("Cons(1, Cons(2, Nil))");
  });

  it("renders atoms, the empty expression, and data tuples", () => {
    expect(toMixfix("foo")).toBe("foo");
    expect(toMixfix("$x")).toBe("$x");
    expect(toMixfix("()")).toBe("()");
    expect(toMixfix("(1 2 3)")).toBe("(1 2 3)");
    expect(toMixfix("(superpose (1 2 3))")).toBe("superpose (1 2 3)");
  });

  it("returns empty string when the source has no form", () => {
    expect(toMixfix("")).toBe("");
    expect(toMixfix("   ")).toBe("");
  });
});

describe("toMixfix — robustness", () => {
  // Validated on 1.5M forms across 900 real MeTTa files with zero throws; this pins that as a property so a
  // future operator-table or recursion change cannot regress it.
  it("never throws and always returns a string on an arbitrary form", () => {
    fc.assert(
      fc.property(richFormArb(4), (form) => {
        expect(typeof toMixfix(form)).toBe("string");
      }),
      { numRuns: 500 },
    );
  });
});
