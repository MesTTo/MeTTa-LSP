// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import { Analyzer, DEFAULT_SETTINGS } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import type {
  PrologDiagnosticProvider,
  PrologDiagnosticSettings,
  PrologSourceDiagnostic,
} from "../prologDiagnostics.js";
import { PrologDiagnosticsScheduler } from "../prologDiagnosticsScheduler.js";

const MAIN = "file:///ws/main.metta";

class AsyncProvider implements PrologDiagnosticProvider {
  public readonly checked: string[] = [];

  public diagnosticsForFile(): readonly PrologSourceDiagnostic[] {
    throw new Error("sync path should not run");
  }

  public async diagnosticsForFileAsync(
    filePath: string,
    _settings: PrologDiagnosticSettings,
  ): Promise<readonly PrologSourceDiagnostic[]> {
    void _settings;
    this.checked.push(filePath);
    return [
      {
        line: 0,
        character: 0,
        severity: DiagnosticSeverity.Error,
        code: "prolog.syntax",
        message: "Syntax error",
      },
    ];
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

describe("PrologDiagnosticsScheduler", () => {
  it("fills cached diagnostics asynchronously and publishes a fresh validation result", async () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/main.metta", '!(import! &self "facts.pl")');
    files.writeFile("/ws/facts.pl", "edge(alice bob).\n");
    const provider = new AsyncProvider();
    const analyzer = new Analyzer(files, undefined, undefined, provider);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.setPrologDiagnosticsMode("cached");
    analyzer.updateDocument(MAIN, '!(import! &self "facts.pl")', 1, true);
    const published: Diagnostic[][] = [];
    const scheduler = new PrologDiagnosticsScheduler(analyzer, provider, {
      debounceMs: 0,
      getSettings: () => DEFAULT_SETTINGS.diagnostics,
      pullDiagnostics: () => false,
      publishDiagnostics: (_uri, diagnostics) => {
        published.push([...diagnostics]);
      },
      refreshDiagnostics: () => undefined,
    });
    expect(analyzer.validate(MAIN).map((diagnostic) => diagnostic.code)).not.toContain(
      "prolog.syntax",
    );
    scheduler.schedule(MAIN);
    await waitFor(() => published.length > 0);
    expect(provider.checked).toStrictEqual(["/ws/facts.pl"]);
    expect(published.at(-1)?.map((diagnostic) => diagnostic.code)).toContain("prolog.syntax");
  });
});
