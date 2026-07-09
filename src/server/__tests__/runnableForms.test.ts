// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The run policy: which heads are runnable and how a single bare form becomes a `!` query. Definition
// heads and module directives must pass through untouched — bang-wrapping a rewrite rule would evaluate
// it instead of defining it.

import { describe, expect, it } from "vitest";
import { isRunnableHead, wrapBareExpression } from "../runnableForms.js";

describe("isRunnableHead", () => {
  it("treats ordinary calls and headless forms as runnable", () => {
    expect(isRunnableHead("compute")).toBe(true);
    expect(isRunnableHead("if")).toBe(true);
    expect(isRunnableHead(null)).toBe(true);
  });

  it("rejects definition and directive heads", () => {
    for (const head of ["=", ":", "macro", "defmacro", "import!", "include", "include!", "bind!"]) {
      expect(isRunnableHead(head)).toBe(false);
    }
  });
});

describe("wrapBareExpression", () => {
  it("wraps a single bare form so evaluation yields its results", () => {
    expect(wrapBareExpression("(compute 5)")).toBe("!(compute 5)");
    expect(wrapBareExpression("compute")).toBe("!compute");
    expect(wrapBareExpression("42")).toBe("!42");
  });

  it("leaves banged sources as written", () => {
    expect(wrapBareExpression("!(compute 5)")).toBe("!(compute 5)");
    expect(wrapBareExpression("! (compute 5)")).toBe("! (compute 5)");
    expect(wrapBareExpression("!compute")).toBe("!compute");
  });

  it("never wraps definition or directive heads", () => {
    for (const source of [
      "(= (f $x) $x)",
      "(: f (-> Number Number))",
      "(macro (m $x) $x)",
      "(defmacro (m $x) $x)",
      "(import! &self lib)",
      "(include lib)",
      "(include! lib)",
      "(bind! &kb (new-space))",
    ]) {
      expect(wrapBareExpression(source)).toBe(source);
    }
  });

  it("leaves multi-form, empty, and blank sources unchanged", () => {
    expect(wrapBareExpression("(f 1)\n(f 2)")).toBe("(f 1)\n(f 2)");
    expect(wrapBareExpression("")).toBe("");
    expect(wrapBareExpression("  ")).toBe("  ");
  });

  it("puts the bang on the form, not on a leading comment", () => {
    expect(wrapBareExpression("; query\n(f 1)")).toBe("; query\n!(f 1)");
  });

  it("does not double-bang a banged form behind a leading comment", () => {
    expect(wrapBareExpression("; c\n!(f 1)")).toBe("; c\n!(f 1)");
    expect(wrapBareExpression("; c\n!42")).toBe("; c\n!42");
  });
});
