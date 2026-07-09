// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The linter as an LSP surface: built-in rules surface as metta-lint diagnostics, a project lint.metta can
// silence a rule or add its own, and a rule's rewrite is offered as a quick-fix code action.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function workspace(source: string, config?: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  if (config !== undefined) files.writeFile("/ws/lint.metta", config);
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

const lintDiags = (analyzer: Analyzer) =>
  analyzer.validate(MAIN).filter((d) => d.source === "metta-lint");

describe("lint diagnostics", () => {
  it("reports a built-in rule as a metta-lint diagnostic", () => {
    const diags = lintDiags(workspace("(= (f $x) (if True $x 0))"));
    const hit = diags.find((d) => d.code === "constant-if-true");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("always True");
  });

  it("silences a rule from lint.metta", () => {
    const diags = lintDiags(
      workspace("(= (f $x) (if True $x 0))", "(lint-severity constant-if-true off)"),
    );
    expect(diags.some((d) => d.code === "constant-if-true")).toBe(false);
  });

  it("promotes a rule to an error via lint.metta", () => {
    const diags = lintDiags(
      workspace("(= (f $x) (if True $x 0))", "(lint-severity constant-if-true deny)"),
    );
    const hit = diags.find((d) => d.code === "constant-if-true");
    // DiagnosticSeverity.Error === 1
    expect(hit?.severity).toBe(1);
  });

  it("runs a project-defined rule from lint.metta", () => {
    const config = '(lint-rule no-debug (pattern (debug! $$$)) (message "leftover debug!"))';
    const diags = lintDiags(workspace("(debug! here)", config));
    expect(diags.some((d) => d.code === "no-debug")).toBe(true);
  });

  it("offers the rule's rewrite as a quick-fix code action", () => {
    const analyzer = workspace("(if True yes no)");
    const actions = analyzer.codeActions(MAIN, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 15 },
    });
    const fix = actions.find((a) => a.title.startsWith("constant-if-true"));
    expect(fix).toBeDefined();
    const edits = fix?.edit?.changes?.[MAIN] ?? [];
    expect(edits[0]?.newText).toBe("yes");
  });
});

describe("semantic lint diagnostics", () => {
  it("places a recursive-type violation at the function's definition", () => {
    const analyzer = workspace("(= (fact $n) (if (== $n 0) 1 (* $n (fact (- $n 1)))))");
    const diags = analyzer.semanticLintDiagnostics(MAIN);
    const hit = diags.find((d) => d.code === "missing-recursive-type");
    expect(hit).toBeDefined();
    expect(hit?.source).toBe("metta-semantic-lint");
    // located on line 0 where fact is defined
    expect(hit?.range.start.line).toBe(0);
  });

  it("stays off in validate by default and turns on with the setting", () => {
    const analyzer = workspace("(= (fact $n) (fact (- $n 1)))");
    expect(analyzer.validate(MAIN).some((d) => d.source === "metta-semantic-lint")).toBe(false);
    analyzer.updateSettings({
      diagnostics: { ...analyzer.getSettings().diagnostics, semanticLint: true },
    });
    expect(analyzer.validate(MAIN).some((d) => d.source === "metta-semantic-lint")).toBe(true);
  });

  it("uses only fresh cached semantic lint diagnostics in cached mode", () => {
    const analyzer = workspace("(= (fact $n) (fact (- $n 1)))");
    analyzer.setSemanticLintMode("cached");
    analyzer.updateSettings({
      diagnostics: { ...analyzer.getSettings().diagnostics, semanticLint: true },
    });
    expect(analyzer.validate(MAIN).some((d) => d.source === "metta-semantic-lint")).toBe(false);

    const input = analyzer.semanticLintInput(MAIN);
    expect(input).not.toBeNull();
    if (input === null) return;
    const diagnostics = analyzer.semanticLintViolationsToDiagnostics(input.uri, [
      {
        rule: "missing-recursive-type",
        severity: "warn",
        symbol: "fact",
        message: "fact is recursive and has no type declaration",
      },
    ]);
    analyzer.setSemanticLintDiagnostics(
      input.uri,
      input.version,
      input.sourceFingerprint,
      input.severityKey,
      diagnostics,
    );
    expect(analyzer.validate(MAIN).some((d) => d.code === "missing-recursive-type")).toBe(true);

    analyzer.updateDocument(MAIN, "(= (fact $n) $n)", 2, true);
    expect(analyzer.validate(MAIN).some((d) => d.code === "missing-recursive-type")).toBe(false);
  });
});
