// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Prolog diagnostics are host-provided and read-only: a `.pl` file referenced from MeTTa is parsed by the
// host provider, while the analyzer reports the problem on the MeTTa path literal.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Analyzer, DEFAULT_SETTINGS } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import type {
  PrologDiagnosticProvider,
  PrologDiagnosticSettings,
  PrologSourceDiagnostic,
} from "../prologDiagnostics.js";

const MAIN = "file:///ws/main.metta";

class FakePrologDiagnostics implements PrologDiagnosticProvider {
  public readonly checked: string[] = [];

  public constructor(
    private readonly diagnostics: readonly PrologSourceDiagnostic[],
    private readonly fail: Error | null = null,
  ) {}

  public diagnosticsForFile(
    filePath: string,
    _settings: PrologDiagnosticSettings,
  ): readonly PrologSourceDiagnostic[] {
    void _settings;
    if (this.fail) throw this.fail;
    this.checked.push(filePath);
    return this.diagnostics;
  }
}

function analyzerFor(
  source: string,
  provider: PrologDiagnosticProvider | undefined = new FakePrologDiagnostics([
    {
      line: 1,
      character: 7,
      severity: DiagnosticSeverity.Error,
      code: "prolog.syntax",
      message: "Syntax error: Operator expected",
    },
  ]),
): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/main.metta", source);
  files.writeFile("/ws/facts.pl", "edge(alice bob).\n");
  const analyzer = new Analyzer(files, undefined, undefined, provider);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

describe("Prolog bridge diagnostics", () => {
  it("reports parser diagnostics from a .pl import on the MeTTa path literal", () => {
    const analyzer = analyzerFor('!(import! &self "facts.pl")');
    const diagnostics = analyzer.validate(MAIN);
    const hit = diagnostics.find((diagnostic) => diagnostic.code === "prolog.syntax");
    expect(hit?.source).toBe("metta-prolog");
    expect(hit?.message).toContain("facts.pl");
    expect(hit?.message).toContain("2:8");
    expect(hit?.range).toStrictEqual({
      start: { line: 0, character: 16 },
      end: { line: 0, character: 26 },
    });
    expect(hit?.relatedInformation?.[0]?.location.uri).toBe("file:///ws/facts.pl");
    expect(hit?.relatedInformation?.[0]?.location.range.start).toStrictEqual({
      line: 1,
      character: 7,
    });
  });

  it("treats quoted .pl import paths as Prolog host imports, not core module imports", () => {
    const codes = analyzerFor('!(import! &self "facts.pl")')
      .validate(MAIN)
      .map((diagnostic) => diagnostic.code);
    expect(codes).not.toContain("import.unresolved");
  });

  it("does not index resolved .pl files as MeTTa closure members", () => {
    const analyzer = analyzerFor('!(import! &self "facts.pl")');
    analyzer.validate(MAIN);
    expect(analyzer.indexedUris()).toStrictEqual([MAIN]);
  });

  it("keeps .pl imports out of the MeTTa source map but exposes their host path", () => {
    const analyzer = analyzerFor('!(import! &self "facts.pl")');
    analyzer.validate(MAIN);
    expect(analyzer.importSourceMap(MAIN)).toStrictEqual({});
    expect(analyzer.importPathMap(MAIN)["facts.pl"]).toBe("/ws/facts.pl");
  });

  it("checks files referenced by import_prolog_functions_from_file", () => {
    const provider = new FakePrologDiagnostics([
      {
        line: 0,
        character: 0,
        severity: DiagnosticSeverity.Error,
        code: "prolog.syntax",
        message: "Syntax error",
      },
    ]);
    const analyzer = analyzerFor(
      '!(import_prolog_functions_from_file "facts.pl" (edge))',
      provider,
    );
    expect(analyzer.validate(MAIN).map((diagnostic) => diagnostic.code)).toContain("prolog.syntax");
    expect(provider.checked).toStrictEqual(["/ws/facts.pl"]);
  });

  it("is gated by diagnostics.prolog", () => {
    const analyzer = analyzerFor('!(import! &self "facts.pl")');
    const diagnostics = analyzer.validate(MAIN, {
      ...DEFAULT_SETTINGS.diagnostics,
      prolog: false,
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("prolog.syntax");
  });

  it("keeps .pl imports from resolving through .metta fallback files", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/main.metta", '!(import! &self "facts.pl")');
    files.writeFile("/ws/facts.pl.metta", "(= (notProlog) 1)");
    const provider = new FakePrologDiagnostics([
      {
        line: 0,
        character: 0,
        severity: DiagnosticSeverity.Error,
        code: "prolog.syntax",
        message: "should not run",
      },
    ]);
    const analyzer = new Analyzer(files, undefined, undefined, provider);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(MAIN, '!(import! &self "facts.pl")', 1, true);
    const codes = analyzer.validate(MAIN).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("import.unresolved");
    expect(codes).not.toContain("prolog.syntax");
    expect(provider.checked).toStrictEqual([]);
  });

  it("does not turn quoted .pl imports into core import warnings when prolog diagnostics are off", () => {
    const diagnostics = analyzerFor('!(import! &self "facts.pl")').validate(MAIN, {
      ...DEFAULT_SETTINGS.diagnostics,
      prolog: false,
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("import.unresolved");
  });

  it("reports unresolved Prolog bridge files", () => {
    const files = new InMemoryFileProvider("/ws");
    const source = '!(prolog-consult "missing.pl")';
    files.writeFile("/ws/main.metta", source);
    const provider = new FakePrologDiagnostics([]);
    const analyzer = new Analyzer(files, undefined, undefined, provider);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(MAIN, source, 1, true);
    const diagnostics = analyzer.validate(MAIN);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain("prolog.unresolved");
    expect(provider.checked).toStrictEqual([]);
  });

  it("supports cached Prolog diagnostics for non-blocking LSP hosts", () => {
    const provider = new FakePrologDiagnostics([
      {
        line: 0,
        character: 0,
        severity: DiagnosticSeverity.Error,
        code: "prolog.syntax",
        message: "Syntax error",
      },
    ]);
    const analyzer = analyzerFor('!(import! &self "facts.pl")', provider);
    analyzer.setPrologDiagnosticsMode("cached");
    expect(analyzer.validate(MAIN).map((diagnostic) => diagnostic.code)).not.toContain(
      "prolog.syntax",
    );
    expect(provider.checked).toStrictEqual([]);
    const input = analyzer.prologDiagnosticsInput(MAIN);
    expect(input).not.toBeNull();
    if (input === null) return;
    const reference = input.references[0];
    expect(reference).toBeDefined();
    if (reference === undefined) return;
    const diagnostics = analyzer.prologSourceDiagnosticsToDiagnostics(
      reference,
      provider.diagnosticsForFile(reference.filePath, DEFAULT_SETTINGS.prolog),
    );
    analyzer.setPrologBridgeDiagnostics(
      input.uri,
      input.version,
      input.referenceKey,
      input.settingsKey,
      diagnostics,
    );
    expect(analyzer.validate(MAIN).map((diagnostic) => diagnostic.code)).toContain("prolog.syntax");
  });

  it("surfaces provider failures instead of throwing out of validation", () => {
    const analyzer = analyzerFor(
      '!(import! &self "facts.pl")',
      new FakePrologDiagnostics([], new Error("bad executable")),
    );
    const diagnostic = analyzer
      .validate(MAIN)
      .find((candidate) => candidate.code === "prolog.backend");
    expect(diagnostic?.message).toContain("bad executable");
  });
});
