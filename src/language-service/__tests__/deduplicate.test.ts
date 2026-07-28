// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { deduplicate } from "../deduplicate.js";

const doc = (uri: string, text: string) => ({ uri, text });

describe("deduplicate", () => {
  it("finds exact and consistently alpha-renamed MeTTa expressions across files", () => {
    const result = deduplicate(
      [
        doc("file:///a.metta", "(= (twice $x) (+ $x $x))\n!(twice 4)"),
        doc("file:///b.metta", "(= (twice $value) (+ $value $value))\n!(twice 4)"),
      ],
      { minAtoms: 3 },
    );

    expect(result.complete).toBe(true);
    expect(
      result.clones.map((clone) => ({
        kind: clone.kind,
        role: clone.role,
        texts: clone.occurrences.map((item) => item.text),
      })),
    ).toContainEqual({
      kind: "alpha-equivalent",
      role: "declaration",
      texts: ["(= (twice $x) (+ $x $x))", "(= (twice $value) (+ $value $value))"],
    });
    const executable = result.clones.find(
      (clone) => clone.kind === "exact" && clone.role === "executable",
    );
    expect(
      executable?.occurrences.some(
        (item) => item.text === "(twice 4)" && item.startLine === 2 && item.startColumn === 2,
      ),
    ).toBe(true);
  });

  it("preserves repeated-variable constraints, argument order, and semantic role", () => {
    const result = deduplicate(
      [
        doc(
          "file:///main.metta",
          ["(= (same $x $x) ok)", "(= (same $a $b) ok)", "!(pair A B)", "!(pair B A)"].join("\n"),
        ),
      ],
      { minAtoms: 2 },
    );

    expect(
      result.clones.some((clone) => clone.occurrences.some((item) => item.text === "(same $x $x)")),
    ).toBe(false);
    expect(
      result.clones.some((clone) => clone.occurrences.some((item) => item.text === "(pair A B)")),
    ).toBe(false);
  });

  it("separates inert data, quoted terms, case patterns, and executable terms", () => {
    const source = [
      "(f A B)",
      "!(quote (f A B))",
      "!(case (+ 1 2) (((+ 1 2) no) (3 (+ 1 2))))",
    ].join("\n");
    const result = deduplicate([doc("file:///main.metta", source)], { minAtoms: 3 });
    const plus = result.clones.find((clone) =>
      clone.occurrences.some((item) => item.text === "(+ 1 2)"),
    );

    expect(plus?.role).toBe("executable");
    expect(plus?.occurrences).toHaveLength(2);
    expect(plus?.occurrences.every((item) => item.role === "executable")).toBe(true);
    expect(
      result.clones.some(
        (clone) =>
          clone.occurrences.some((item) => item.role === "quoted") &&
          clone.occurrences.some((item) => item.role === "data"),
      ),
    ).toBe(false);
  });

  it("suppresses clones contained entirely in a larger clone but keeps an extra inner occurrence", () => {
    const source = ["!(outer (inner A B))", "!(outer (inner A B))", "!(inner A B)"].join("\n");
    const result = deduplicate([doc("file:///main.metta", source)], { minAtoms: 3 });

    expect(result.clones.map((clone) => clone.occurrences[0]?.text)).toStrictEqual([
      "(outer (inner A B))",
      "(inner A B)",
    ]);
  });

  it("reports malformed files and excludes their recovered trees", () => {
    const result = deduplicate(
      [doc("file:///good.metta", "!(f A)\n!(f A)"), doc("file:///bad.metta", "!(f A")],
      { minAtoms: 2 },
    );

    expect(result.complete).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.uri).toBe("file:///bad.metta");
    expect(typeof result.issues[0]?.code).toBe("string");
    expect(result.clones).toHaveLength(1);
  });

  it("is deterministic across document input order", () => {
    const documents = [doc("file:///b.metta", "!(f $b)\n"), doc("file:///a.metta", "!(f $a)\n")];
    expect(deduplicate(documents, { minAtoms: 2 })).toStrictEqual(
      deduplicate([...documents].reverse(), { minAtoms: 2 }),
    );
  });
});
