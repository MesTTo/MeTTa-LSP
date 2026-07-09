// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Structural search and replace: matching a MeTTa pattern over a document's forms and rewriting matches with
// a template that substitutes the captures.

import { describe, expect, it } from "vitest";
import { structuralReplace, structuralSearch } from "../search.js";

describe("structuralSearch", () => {
  it("finds every form matching the pattern, nested ones included", () => {
    const src = "(= (a $x) (if True $x 0))\n(= (c) (foo (if True 2 3)))";
    const matches = structuralSearch(src, "(if True $T $E)");
    expect(matches.map((m) => m.text)).toEqual(["(if True $x 0)", "(if True 2 3)"]);
  });

  it("binds a metavar to the same subterm each time it repeats", () => {
    const matches = structuralSearch("(dup a a) (dup a b)", "(dup $X $X)");
    expect(matches.map((m) => m.text)).toEqual(["(dup a a)"]);
  });

  it("returns nothing for a pattern that is not one well-formed form", () => {
    expect(structuralSearch("(a) (b)", "(a) (b)")).toEqual([]);
    expect(structuralSearch("(a)", "(a")).toEqual([]);
  });
});

describe("structuralReplace", () => {
  it("substitutes the captures into the template", () => {
    const { text, count } = structuralReplace(
      "(= (a $x) (if True $x 0))\n(= (b $y) (if True (f $y) 1))",
      "(if True $T $E)",
      "$T",
    );
    expect(text).toBe("(= (a $x) $x)\n(= (b $y) (f $y))");
    expect(count).toBe(2);
  });

  it("rewrites a call head while preserving the argument capture", () => {
    const { text } = structuralReplace("(c (foo (if True 2 3)))", "(foo $X)", "(bar $X)");
    expect(text).toBe("(c (bar (if True 2 3)))");
  });

  it("captures a run of arguments with an ellipsis", () => {
    const { text } = structuralReplace("(log a b c)", "(log $$$rest)", "(trace $$$rest)");
    expect(text).toBe("(trace a b c)");
  });

  it("is a no-op when the pattern or template is malformed", () => {
    expect(structuralReplace("(a)", "(a", "(b)")).toEqual({ text: "(a)", count: 0 });
    expect(structuralReplace("(a)", "(a)", "(b").count).toBe(0);
  });
});
