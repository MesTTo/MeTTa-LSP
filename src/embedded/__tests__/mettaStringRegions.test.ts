// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Discovery of MeTTa source hidden in plain string arguments of the eDSL calls the template decorator does
// not see: parseSource("..."), db.q("..."), db.run("..."). Regions are found only in files that import the
// eDSL, and escaped strings are skipped because their positions would not map linearly to the source.

import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { findMettaStringRegions } from "../mettaStringRegions.js";

function regions(source: string): ReturnType<typeof findMettaStringRegions> {
  const sourceFile = ts.createSourceFile("/x.ts", source, ts.ScriptTarget.Latest, true);
  return findMettaStringRegions(ts, sourceFile);
}

const IMPORT = 'import { mettaDB, parseSource } from "@metta-ts/edsl";\n';

describe("findMettaStringRegions", () => {
  it("finds db.q, parseSource, and db.run string arguments", () => {
    const source = `${IMPORT}${[
      "const db = mettaDB();",
      'db.q("(Likes Ada $thing)");',
      'parseSource("(foo)");',
      'db.run("(bar)");',
    ].join("\n")}`;
    const found = regions(source).map((region) => region.text);
    expect(found).toContain("(Likes Ada $thing)");
    expect(found).toContain("(foo)");
    expect(found).toContain("(bar)");
  });

  it("maps a region's content span to the characters inside the quotes", () => {
    const source = `${IMPORT}parseSource("(foo)");`;
    const [region] = regions(source);
    expect(region).toBeDefined();
    expect(source[region?.contentStart ?? -1]).toBe("(");
    expect(source.slice(region?.contentStart, region?.contentEnd)).toBe("(foo)");
  });

  it("ignores files that do not import the eDSL", () => {
    const source = ["const db = makeThing();", 'db.q("(foo)");'].join("\n");
    expect(regions(source)).toHaveLength(0);
  });

  it("skips strings with escape sequences, where positions would not map linearly", () => {
    const source = `${IMPORT}parseSource("(concat \\"hi\\" $x)");`;
    expect(regions(source)).toHaveLength(0);
  });

  it("only matches the first argument, not a string somewhere else in the call", () => {
    const source = `${IMPORT}db.run("(foo)", "not metta");`;
    expect(regions(source).map((region) => region.text)).toStrictEqual(["(foo)"]);
  });
});
