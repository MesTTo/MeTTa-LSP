// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The "add type declaration" suggestion: an untyped function definition offers a RefactorRewrite that
// inserts a (: name (-> ...)) scaffold above it, with literal-argument types filled in and placeholders
// elsewhere. It is withheld when a type is already declared and for constant definitions.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/t.metta";

function analyzerWith(src: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/t.metta", src);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, src, 1, true);
  return analyzer;
}

// The add-type code action for a caret on the definition's first line.
function addTypeAction(src: string, line = 0, character = 4) {
  return analyzerWith(src)
    .codeActions(URI, { start: { line, character }, end: { line, character } })
    .find((action) => action.title.startsWith("Add type declaration"));
}

function insertedText(src: string, line = 0, character = 4): string | undefined {
  return addTypeAction(src, line, character)?.edit?.changes?.[URI]?.[0]?.newText;
}

describe("add type declaration suggestion", () => {
  it("scaffolds a signature, typing a literal argument and reading the body's return type", () => {
    // $x is a placeholder; the body (+ $x 1) returns Number, so the return slot is Number.
    expect(insertedText("(= (inc $x) (+ $x 1))")).toBe("(: inc (-> $a Number))\n");
  });

  it("types a literal argument slot exactly", () => {
    // The 0 argument types its slot Number; the 1 body is Number.
    expect(insertedText("(= (fact 0) 1)")).toBe("(: fact (-> Number Number))\n");
  });

  it("falls back to a placeholder for a polymorphic body instead of leaking a type variable", () => {
    // get-type of `(if ...)` reduces to the arrow's uninstantiated return variable `$t` (the interpreter does
    // not unify the branches), so the return slot stays the `$ret` placeholder rather than leaking `$t`.
    expect(insertedText("(= (f $x) (if (> $x 0) 1 2))")).toBe("(: f (-> $a $ret))\n");
  });

  it("carries the rationale that typed functions interpret faster", () => {
    expect(addTypeAction("(= (inc $x) (+ $x 1))")?.title).toContain("interpret faster");
  });

  it("inserts on the line above a definition lower in the file", () => {
    const src = "(= (a) 1)\n\n(= (double $x) (+ $x $x))";
    const edit = addTypeAction(src, 2, 4)?.edit?.changes?.[URI]?.[0];
    expect(edit?.newText).toBe("(: double (-> $a Number))\n");
    expect(edit?.range.start).toStrictEqual({ line: 2, character: 0 });
  });

  it("is withheld when a type is already declared", () => {
    const src = "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))";
    expect(addTypeAction(src, 1, 4)).toBeUndefined();
  });

  it("is withheld for a constant definition", () => {
    expect(addTypeAction("(= pi 3.14)")).toBeUndefined();
  });
});
