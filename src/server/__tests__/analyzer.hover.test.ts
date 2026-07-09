// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Hover follows the rust-analyzer layout: the signature in a syntax-highlighted metta fence, a horizontal
// rule, the documentation, then a subtle origin line. The signature is the interpreter-exact type from live
// @metta-ts/core introspection (what !(get-type <symbol>) returns), cached by both epochs so a re-hover is
// free and an edit that changes the type is reflected. Uninformative types (%Undefined%, Atom) are not shown.

import { format, runProgram } from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function hoverText(analyzer: Analyzer, line: number, character: number): string {
  const hover = analyzer.hover(URI, { line, character });
  if (hover === null) return "";
  const contents = hover.contents;
  return typeof contents === "object" && "value" in contents ? contents.value : "";
}

// The interpreter's get-type answer for `expr` in the file's declaration context, computed directly.
function coreType(context: string, expr: string): string {
  const last = runProgram(`${context}\n!(get-type ${expr})`).at(-1);
  return last ? last.results.map(format).join(" | ") : "";
}

describe("Analyzer hover — interpreter-exact signature", () => {
  it("shows a user function's type in the signature fence, matching core", () => {
    const text = "(: foo (-> Number Number))\n(= (foo $x) (+ $x 1))";
    const analyzer = analyzerWith(text);
    // Hover the `foo` in the type declaration on line 0 (chars 3..6).
    const value = hoverText(analyzer, 0, 4);
    const expected = coreType(text, "foo");
    expect(expected).toBe("(-> Number Number)");
    expect(value).toContain("```metta");
    expect(value).toContain(expected);
    // The old metadata-bullet noise is gone.
    expect(value).not.toContain("Type (interpreter):");
    expect(value).not.toMatch(/\*\*foo\*\*/);
  });

  it("shows a grounded operator's signature in the fence", () => {
    const analyzer = analyzerWith("(= (twice $x) (+ $x $x))");
    // Hover the `+` on line 0 (inside the body). A single-char token matches at its end offset, so hit char 16.
    const value = hoverText(analyzer, 0, 16);
    expect(value).toContain("```metta");
    // The catalog signature carries the return type; the interpreter arrow type would be an alternative.
    expect(value).toContain("-> Number");
  });

  it("caches the type by both epochs and retires it when the type changes", () => {
    const text = "(: foo (-> Number Number))\n(= (foo $x) (+ $x 1))";
    const analyzer = analyzerWith(text);
    hoverText(analyzer, 0, 4);
    expect(analyzer.cachedRuntimeAnswer("get-type", `${URI} foo`)).toBe("(-> Number Number)");

    // Change foo's declared type; the syntax epoch advances, retiring the cached answer.
    const next = "(: foo (-> Number Bool))\n(= (foo $x) (> $x 1))";
    analyzer.updateDocument(URI, next, 2, true);
    expect(analyzer.cachedRuntimeAnswer("get-type", `${URI} foo`)).toBeUndefined();
    expect(hoverText(analyzer, 0, 4)).toContain("(-> Number Bool)");
  });

  it("renders interpreter documentation from get-doc on hover", () => {
    const text = [
      "(: inc (-> Number Number))",
      "(= (inc $x) (+ $x 1))",
      '(@doc inc (@desc "adds one") (@params ((@param "the number"))) (@return "the successor"))',
    ].join("\n");
    const value = hoverText(analyzerWith(text), 0, 4);
    expect(value).toContain("adds one");
    expect(value).toContain("the successor");
  });
});

describe("Analyzer hover — rust-analyzer layout and docs link", () => {
  it("lays out the signature fence, a rule, then the origin line", () => {
    const value = hoverText(
      analyzerWith("(: foo (-> Number Number))\n(= (foo $x) (+ $x 1))"),
      0,
      4,
    );
    expect(value).toContain("```metta");
    expect(value).toContain("(-> Number Number)");
    expect(value).toContain("\n---\n");
    // The origin labels whether the signature came from a declaration or the interpreter.
    expect(value).toContain("_declared type · m.metta_");
  });

  it("appends an Open docs link for a builtin when a docs base is configured", () => {
    const analyzer = analyzerWith("(= (twice $x) (+ $x $x))");
    analyzer.updateSettings({ docs: { baseUrl: "https://docs.example/metta" } });
    // Hover the `+` grounded builtin in the body.
    const value = hoverText(analyzer, 0, 16);
    expect(value).toContain("[Open docs](https://docs.example/metta/reference/builtins#_2b_)");
  });

  it("shows no docs link with no base, and never for a user symbol", () => {
    const withoutBase = analyzerWith("(= (twice $x) (+ $x $x))");
    expect(hoverText(withoutBase, 0, 16)).not.toContain("Open docs");
    const userSym = analyzerWith("(: foo (-> Number Number))\n(= (foo $x) (+ $x 1))");
    userSym.updateSettings({ docs: { baseUrl: "https://docs.example/metta" } });
    // foo is user-defined, not catalogued, so it gets no docs link even with a base set.
    expect(hoverText(userSym, 0, 4)).not.toContain("Open docs");
  });

  it("uses doc comments and @doc atoms, not ordinary tutorial comments, for hovers", () => {
    const source = [
      "; Ordinary tutorial prose above fib should not become hover docs.",
      "(: fib (-> Number Number))",
      "(= (fib $n) $n)",
      "",
      ";; Doubles a number.",
      "(: double (-> Number Number))",
      "(= (double $x) (* $x 2))",
      "",
      "; @desc Triples a number.",
      "(: triple (-> Number Number))",
      "(= (triple $x) (* $x 3))",
      "",
      "(: Shape Type)",
      "",
      "; `Shape` is a type. Type Definition on Shape jumps to its declaration above.",
      "(: perimeter (-> Shape Number Number))",
      "",
      "; A multi-line definition for folding and selection-range expansion. Put the",
      "; cursor inside `(case ...)`, then run Expand Selection several times.",
      "(= (describe-shape $shape $size)",
      "   (case $shape",
      "     ((Shape $size))))",
    ].join("\n");
    const analyzer = analyzerWith(source);

    const fib = hoverText(analyzer, 1, 4);
    expect(fib).not.toContain("Ordinary tutorial prose");

    expect(hoverText(analyzer, 5, 4)).toContain("Doubles a number.");
    expect(hoverText(analyzer, 9, 4)).toContain("Triples a number.");

    const perimeter = hoverText(analyzer, 15, 4);
    expect(perimeter).toContain("declared type");
    expect(perimeter).not.toContain("Type Definition");
    expect(perimeter).not.toContain("jumps to its declaration");

    const describeShape = hoverText(analyzer, 19, 6);
    expect(describeShape).not.toContain("Put the");
    expect(describeShape).not.toContain("Expand Selection");
  });
});

describe("Analyzer hover — guarded evaluation preview", () => {
  it("previews the reduced value of the runnable form under the cursor", () => {
    const analyzer = analyzerWith("(= (double $x) (* $x 2))\n!(double 21)");
    const value = hoverText(analyzer, 1, 4); // `double` inside !(double 21)
    expect(value).toContain("Evaluates to");
    expect(value).toContain("42");
  });

  it("does not preview when the cursor is not on a runnable form", () => {
    // A definition is not runnable, so hovering its head shows no evaluation preview.
    expect(hoverText(analyzerWith("(= (double $x) (* $x 2))"), 0, 4)).not.toContain("Evaluates to");
  });
});
