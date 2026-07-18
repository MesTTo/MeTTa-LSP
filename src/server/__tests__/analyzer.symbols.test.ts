// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Characterization of the symbol, completion, and signature-help features, locking the behavior on the
// core-backed parse layer.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

const SRC = [
  "(: greet (-> String String))",
  '(= (greet $name) (concat "hi " $name))',
  "(: Color Type)",
  "(: Red Color)",
  '(greet "world")',
].join("\n");

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

describe("symbols and completion", () => {
  it("lists the document's definitions as document symbols", () => {
    const names = analyzerWith(SRC)
      .documentSymbols(URI)
      .map((symbol) => symbol.name);
    expect(names).toContain("greet");
    expect(names).toContain("Color");
    expect(names).toContain("Red");
  });

  it("filters workspace symbols by a case-insensitive query", () => {
    const names = analyzerWith(SRC)
      .workspaceSymbols("gree")
      .map((symbol) => symbol.name);
    expect(names).toContain("greet");
    expect(names).not.toContain("Color");
  });

  it("scopes workspace symbols to the current workspace roots and applies limits", async () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/m.metta", SRC);
    files.writeFile("/other/m.metta", "(: other-square Type)\n(: other-square-value other-square)");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws", "file:///other"]);
    await analyzer.scanWorkspace();

    analyzer.setWorkspaceRoots(["file:///ws"]);
    const names = analyzer.workspaceSymbols("", { limit: 2 }).map((symbol) => symbol.name);

    expect(names).toHaveLength(2);
    expect(names).toContain("greet");
    expect(names).not.toContain("other-square");
  });

  it("offers completions that include workspace definitions and builtins", () => {
    // At the start of a fresh call (right after `(`, empty prefix) the full set is offered.
    const labels = new Set(
      analyzerWith(SRC)
        .completions(URI, { line: 4, character: 1 })
        .map((item) => item.label),
    );
    expect(labels.has("greet")).toBe(true);
    expect(labels.has("match")).toBe(true);
    expect(labels.has("size-atom")).toBe(true);
  });

  it("filters completions by the typed prefix", () => {
    // At the end of `greet`, only names starting with that prefix remain.
    const labels = analyzerWith(SRC)
      .completions(URI, { line: 4, character: 6 })
      .map((item) => item.label);
    expect(labels).toContain("greet");
    expect(labels).not.toContain("match");
  });

  it("resolves a completion item to documentation", () => {
    const analyzer = analyzerWith(SRC);
    const item = analyzer
      .completions(URI, { line: 4, character: 6 })
      .find((candidate) => candidate.label === "greet");
    expect(item).toBeDefined();
    const resolved = analyzer.resolveCompletion(item!);
    expect(resolved.documentation).toBeDefined();
  });

  it("gives signature help inside a call, with the callee's signature", () => {
    // inside `(greet "world")` on line 4, just after the head.
    const help = analyzerWith(SRC).signatureHelp(URI, { line: 4, character: 7 });
    expect(help).not.toBeNull();
    // the signature label is the declared arrow signature.
    expect(help?.signatures[0]?.label).toContain("->");
  });
});
