// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// End to end with a real TypeScript host: a `.metta` document references a grounded operation registered in
// an on-disk `host.ts` and a `(js-atom "Math.max")` global, and the analyzer — wired to a real
// `HostTypeService`, not a stub — resolves both through the checker for hover and cross-language
// go-to-definition. This is the strongest proof the whole chain works: CST site classification, the overlay
// language service, signature extraction, and the analyzer surfacing.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Hover, MarkupContent } from "vscode-languageserver-types";
import { pathToUri } from "../../language-service/index.js";
import { Analyzer } from "../analyzer.js";
import { writeBridgeFixture } from "../bridge/__tests__/fixtureProject.js";
import { HostTypeService } from "../bridge/hostTypeService.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const HOST_TS = `import { MeTTa } from "@metta-ts/hyperon";

/** Larger of two numbers. */
export function myMax(a: number, b: number): number {
  return a > b ? a : b;
}

const m = new MeTTa();
m.registerOperation("my-max", myMax);
`;

const METTA_SRC = [
  "(= (double $x) (my-max $x $x))",
  '(= (biggest) (js-atom "Math.max"))',
  '(= (bad) (my-max "x" 2))',
].join("\n");

let dir: string;
let analyzer: Analyzer;
let uri: string;

beforeAll(() => {
  dir = writeBridgeFixture(HOST_TS);
  const files = new InMemoryFileProvider(dir);
  analyzer = new Analyzer(files, undefined, new HostTypeService(dir));
  analyzer.setWorkspaceRoots([pathToUri(dir)]);
  uri = pathToUri(path.join(dir, "main.metta"));
  analyzer.updateDocument(uri, METTA_SRC, 1, true);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const hoverText = (hover: Hover | null): string =>
  hover === null ? "" : (hover.contents as MarkupContent).value;

describe("analyzer host bridge — real TypeScript end to end", () => {
  it("hovers a grounded operation with its resolved host signature and docs", () => {
    const text = hoverText(analyzer.hover(uri, { line: 0, character: 18 }));
    expect(text).toContain("Host (TypeScript)");
    expect(text).toContain("(-> Number Number Number)");
    expect(text).toContain("Larger of two numbers.");
  });

  it("goes to the host declaration of a grounded operation", () => {
    const locations = analyzer.definition(uri, { line: 0, character: 18 });
    expect(locations.some((location) => location.uri.endsWith("host.ts"))).toBe(true);
  });

  it("hovers a js-atom global resolved against the ambient lib", () => {
    const text = hoverText(analyzer.hover(uri, { line: 1, character: 26 }));
    expect(text).toContain("js-global");
    expect(text).toContain("Math.max");
  });

  it("goes to the ambient lib declaration of a js-atom global", () => {
    const locations = analyzer.definition(uri, { line: 1, character: 26 });
    expect(locations.some((location) => location.uri.includes("lib."))).toBe(true);
  });

  it("diagnoses a literal argument that conflicts with the resolved host parameter type", () => {
    const diagnostic = analyzer
      .validate(uri)
      .find((d) => d.source === "metta-bridge" && d.code === "host-arg-type");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.message).toContain("expects Number");
    // anchored on the offending string literal on line 2
    expect(diagnostic?.range.start.line).toBe(2);
  });
});
