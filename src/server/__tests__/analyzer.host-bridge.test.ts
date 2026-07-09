// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The analyzer surfaces an injected host bridge: hover on a grounded operation (or a `(js-atom "path")`
// string) appends the TypeScript host signature, and go-to-definition jumps across the language boundary to
// the host declaration. A fake bridge stands in for the real `ts.LanguageService` here — the concrete host
// resolution is covered by the host-type-service tests; this pins the analyzer's wiring of it.

import { describe, expect, it } from "vitest";
import type { Hover, MarkupContent } from "vscode-languageserver-types";
import { Analyzer } from "../analyzer.js";
import type { HostBinding, HostBridge } from "../bridge/hostBridge.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

const OP_BINDING: HostBinding = {
  name: "my-max",
  kind: "operation",
  signature: {
    label: "(a: number, b: number): number",
    params: [
      { name: "a", tsType: "number", mettaType: "Number", optional: false, rest: false },
      { name: "b", tsType: "number", mettaType: "Number", optional: false, rest: false },
    ],
    returnTsType: "number",
    returnMettaType: "Number",
    mettaArrow: "(-> Number Number Number)",
    documentation: "Larger of two numbers.",
  },
  definition: {
    uri: "file:///ws/ops.ts",
    range: { start: { line: 2, character: 16 }, end: { line: 2, character: 22 } },
  },
  origin: "ops.ts",
};

const JS_ATOM_BINDING: HostBinding = {
  name: "Math.max",
  kind: "js-global",
  signature: {
    label: "(...values: number[]): number",
    params: [
      { name: "values", tsType: "number[]", mettaType: "%Undefined%", optional: false, rest: true },
    ],
    returnTsType: "number",
    returnMettaType: "Number",
    mettaArrow: "(-> %Undefined% Number)",
    documentation: undefined,
  },
  definition: {
    uri: "file:///lib.es5.d.ts",
    range: { start: { line: 100, character: 4 }, end: { line: 100, character: 7 } },
  },
  origin: "lib.es5.d.ts",
};

class FakeBridge implements HostBridge {
  public ready(): boolean {
    return true;
  }
  public lookupOperation(name: string): HostBinding | undefined {
    return name === "my-max" ? OP_BINDING : undefined;
  }
  public probeGlobal(path: string): HostBinding | undefined {
    return path === "Math.max" ? JS_ATOM_BINDING : undefined;
  }
}

function workspace(source: string, bridge?: HostBridge): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files, undefined, bridge);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

const hoverText = (hover: Hover | null): string =>
  hover === null ? "" : (hover.contents as MarkupContent).value;

describe("analyzer host bridge — hover", () => {
  it("shows the host signature for a grounded operation with no MeTTa definition", () => {
    const analyzer = workspace("(= (double $x) (my-max $x $x))", new FakeBridge());
    const text = hoverText(analyzer.hover(MAIN, { line: 0, character: 18 }));
    expect(text).toContain("Host (TypeScript)");
    expect(text).toContain("(-> Number Number Number)");
    expect(text).toContain("Larger of two numbers.");
    expect(text).toContain("Host source: ops.ts");
  });

  it("appends the host signature below an operation that also has a MeTTa definition", () => {
    const source = "(= (my-max $a $b) (if (> $a $b) $a $b))\n(= (double $x) (my-max $x $x))";
    const analyzer = workspace(source, new FakeBridge());
    const text = hoverText(analyzer.hover(MAIN, { line: 1, character: 18 }));
    expect(text).toContain("my-max");
    expect(text).toContain("Host (TypeScript)");
  });

  it("resolves a js-atom string to the probed global signature", () => {
    const analyzer = workspace('(= (biggest $xs) (js-atom "Math.max"))', new FakeBridge());
    const text = hoverText(analyzer.hover(MAIN, { line: 0, character: 30 }));
    expect(text).toContain("js-global");
    expect(text).toContain("Math.max");
  });

  it("stays inert when no bridge is injected", () => {
    const analyzer = workspace("(= (double $x) (my-max $x $x))");
    expect(hoverText(analyzer.hover(MAIN, { line: 0, character: 18 }))).toBe("");
  });
});

describe("analyzer host bridge — definition", () => {
  it("adds the cross-language host declaration for a grounded operation", () => {
    const analyzer = workspace("(= (double $x) (my-max $x $x))", new FakeBridge());
    const locations = analyzer.definition(MAIN, { line: 0, character: 18 });
    expect(locations.some((location) => location.uri === "file:///ws/ops.ts")).toBe(true);
  });

  it("jumps into the ambient lib for a js-atom global", () => {
    const analyzer = workspace('(= (biggest $xs) (js-atom "Math.max"))', new FakeBridge());
    const locations = analyzer.definition(MAIN, { line: 0, character: 30 });
    expect(locations.some((location) => location.uri === "file:///lib.es5.d.ts")).toBe(true);
  });
});

const bridgeDiags = (analyzer: Analyzer) =>
  analyzer.validate(MAIN).filter((diagnostic) => diagnostic.source === "metta-bridge");

describe("analyzer host bridge — diagnostics", () => {
  it("flags a literal call argument that conflicts with the host parameter type", () => {
    const analyzer = workspace('(= (f) (my-max "a" 2))', new FakeBridge());
    const diags = bridgeDiags(analyzer);
    const hit = diags.find((diagnostic) => diagnostic.code === "host-arg-type");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("expects Number for argument 1");
  });

  it("accepts literal arguments that match the host parameter types", () => {
    expect(bridgeDiags(workspace("(= (f) (my-max 1 2))", new FakeBridge()))).toHaveLength(0);
  });

  it("does not flag variable arguments, whose type it cannot know", () => {
    expect(bridgeDiags(workspace("(= (f $x) (my-max $x 2))", new FakeBridge()))).toHaveLength(0);
  });

  it("cross-checks a MeTTa type declaration against the host signature", () => {
    const analyzer = workspace("(: my-max (-> String String String))", new FakeBridge());
    const hit = bridgeDiags(analyzer).find((d) => d.code === "host-decl-mismatch");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("host type is Number");
  });

  it("does not flag a MeTTa declaration that agrees with the host", () => {
    const analyzer = workspace("(: my-max (-> Number Number Number))", new FakeBridge());
    expect(bridgeDiags(analyzer)).toHaveLength(0);
  });

  it("stays inert with no bridge and when the setting is off", () => {
    expect(bridgeDiags(workspace('(= (f) (my-max "a" 2))'))).toHaveLength(0);
    const analyzer = workspace('(= (f) (my-max "a" 2))', new FakeBridge());
    analyzer.updateSettings({
      diagnostics: { ...analyzer.getSettings().diagnostics, bridge: false },
    });
    expect(bridgeDiags(analyzer)).toHaveLength(0);
  });
});

describe("analyzer host bridge — hostTypeAt", () => {
  it("returns the host binding for the grounded atom at a position (the MCP entry)", () => {
    const analyzer = workspace("(= (double $x) (my-max $x $x))", new FakeBridge());
    expect(analyzer.hostTypeAt(MAIN, { line: 0, character: 18 })?.name).toBe("my-max");
  });

  it("returns undefined off a grounded atom", () => {
    const analyzer = workspace("(= (double $x) (my-max $x $x))", new FakeBridge());
    expect(analyzer.hostTypeAt(MAIN, { line: 0, character: 4 })).toBeUndefined();
  });
});
