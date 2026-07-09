// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";
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

class AbortableProvider implements PrologDiagnosticProvider {
  public aborted = false;
  public started = false;

  public diagnosticsForFile(): readonly PrologSourceDiagnostic[] {
    throw new Error("sync path should not run");
  }

  public diagnosticsForFileAsync(
    _filePath: string,
    _settings: PrologDiagnosticSettings,
    signal?: AbortSignal,
  ): Promise<readonly PrologSourceDiagnostic[]> {
    void _filePath;
    void _settings;
    this.started = true;
    return new Promise((resolve) => {
      signal?.addEventListener(
        "abort",
        () => {
          this.aborted = true;
          resolve([]);
        },
        { once: true },
      );
    });
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("aborts provider work when the scheduler timeout publishes a timeout diagnostic", async () => {
    vi.useFakeTimers();
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/main.metta", '!(import! &self "facts.pl")');
    files.writeFile("/ws/facts.pl", "edge(alice bob).\n");
    const provider = new AbortableProvider();
    const analyzer = new Analyzer(files, undefined, undefined, provider);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.setPrologDiagnosticsMode("cached");
    analyzer.updateSettings({ prolog: { ...DEFAULT_SETTINGS.prolog, timeoutMs: 1 } });
    analyzer.updateDocument(MAIN, '!(import! &self "facts.pl")', 1, true);
    const published: Diagnostic[][] = [];
    const scheduler = new PrologDiagnosticsScheduler(analyzer, provider, {
      debounceMs: 0,
      getSettings: () => analyzer.getSettings().diagnostics,
      pullDiagnostics: () => false,
      publishDiagnostics: (_uri, diagnostics) => {
        published.push([...diagnostics]);
      },
      refreshDiagnostics: () => undefined,
    });

    scheduler.schedule(MAIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.started).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(provider.aborted).toBe(true);
    expect(published.at(-1)?.map((diagnostic) => diagnostic.code)).toContain("prolog.timeout");
    scheduler.dispose();
  });
});
