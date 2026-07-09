// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import type { Analyzer, PrologDiagnosticsInput, PrologFileReference } from "./analyzer.js";
import {
  clearDebouncedState,
  createDiagnosticInputScheduler,
  type DebouncedDiagnosticState,
  DiagnosticInputScheduler,
  disposeDebouncedStates,
  publishOrRefreshDiagnostics,
  unrefTimer,
} from "./diagnosticSchedulerUtils.js";
import type {
  PrologDiagnosticProvider,
  PrologDiagnosticSettings,
  PrologSourceDiagnostic,
} from "./prologDiagnostics.js";
import type { DiagnosticSettings } from "./types.js";

export interface PrologDiagnosticsSchedulerOptions {
  readonly debounceMs?: number;
  readonly getSettings: () => DiagnosticSettings;
  readonly pullDiagnostics: () => boolean;
  readonly publishDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
  readonly refreshDiagnostics: () => void;
  readonly logError?: (message: string) => void;
}

interface ScheduledState extends DebouncedDiagnosticState {
  readonly generation: number;
  readonly timer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_DEBOUNCE_MS = 150;

function providerFailureDiagnostic(error: unknown): PrologSourceDiagnostic {
  return {
    line: 0,
    character: 0,
    severity: DiagnosticSeverity.Warning,
    code: "prolog.backend",
    message: `SWI-Prolog diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function timeoutDiagnostic(timeoutMs: number): PrologSourceDiagnostic {
  return {
    line: 0,
    character: 0,
    severity: DiagnosticSeverity.Warning,
    code: "prolog.timeout",
    message: `SWI-Prolog diagnostics timed out after ${timeoutMs} ms`,
  };
}

async function providerDiagnostics(
  provider: PrologDiagnosticProvider,
  filePath: string,
  settings: PrologDiagnosticSettings,
): Promise<readonly PrologSourceDiagnostic[]> {
  try {
    if (provider.diagnosticsForFileAsync !== undefined)
      return await provider.diagnosticsForFileAsync(filePath, settings);
    return provider.diagnosticsForFile(filePath, settings);
  } catch (error) {
    return [providerFailureDiagnostic(error)];
  }
}

export async function collectPrologBridgeDiagnostics(
  analyzer: Analyzer,
  provider: PrologDiagnosticProvider,
  input: PrologDiagnosticsInput,
): Promise<Diagnostic[]> {
  const settings = analyzer.getSettings().prolog;
  const byPath = new Map<string, Promise<readonly PrologSourceDiagnostic[]>>();
  for (const ref of input.references) {
    if (!byPath.has(ref.filePath))
      byPath.set(ref.filePath, providerDiagnostics(provider, ref.filePath, settings));
  }
  const diagnostics: Diagnostic[] = [];
  for (const ref of input.references) {
    const promise = byPath.get(ref.filePath);
    if (promise === undefined) continue;
    diagnostics.push(...analyzer.prologSourceDiagnosticsToDiagnostics(ref, await promise));
  }
  return diagnostics;
}

export class PrologDiagnosticsScheduler {
  private readonly states = new Map<string, ScheduledState>();
  private readonly debounceMs: number;
  private readonly inputScheduler: DiagnosticInputScheduler<PrologDiagnosticsInput, ScheduledState>;

  public constructor(
    private readonly analyzer: Analyzer,
    private readonly provider: PrologDiagnosticProvider,
    private readonly options: PrologDiagnosticsSchedulerOptions,
  ) {
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.inputScheduler = createDiagnosticInputScheduler(
      this.states,
      () => this.debounceMs,
      (uri) => this.analyzer.hasFreshPrologDiagnostics(uri),
      (uri) => this.analyzer.prologDiagnosticsInput(uri),
      (uri) => this.cancel(uri),
      (uri) => this.analyzer.clearPrologDiagnostics(uri),
      (input, generation) => this.start(input, generation),
    );
  }

  public schedule(uri: string): void {
    this.inputScheduler.schedule(uri, this.options.getSettings().prolog);
  }

  public scheduleAll(uris: readonly string[]): void {
    uris.forEach((uri) => {
      this.schedule(uri);
    });
  }

  public cancel(uri: string): void {
    clearDebouncedState(this.states, uri);
  }

  public dispose(): void {
    disposeDebouncedStates(this.states, (uri) => this.cancel(uri));
  }

  private start(input: PrologDiagnosticsInput, generation: number): void {
    const current = this.analyzer.prologDiagnosticsInput(input.uri);
    if (!this.sameInput(input, current)) return;
    const timeoutMs = Math.max(
      1_000,
      this.analyzer.getSettings().prolog.timeoutMs * input.references.length + 250,
    );
    const timer = setTimeout(() => {
      this.finishWithDiagnostics(input, generation, this.timeoutDiagnostics(input, timeoutMs));
    }, timeoutMs);
    unrefTimer(timer);
    this.run(input)
      .then((diagnostics) => {
        clearTimeout(timer);
        this.finishWithDiagnostics(input, generation, diagnostics);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        this.options.logError?.(`Prolog diagnostics failed: ${String(error)}`);
        this.finishWithDiagnostics(
          input,
          generation,
          this.failureDiagnostics(input.references, error),
        );
      });
  }

  private async run(input: PrologDiagnosticsInput): Promise<Diagnostic[]> {
    return collectPrologBridgeDiagnostics(this.analyzer, this.provider, input);
  }

  private sameInput(
    expected: PrologDiagnosticsInput,
    current: PrologDiagnosticsInput | null,
  ): current is PrologDiagnosticsInput {
    return (
      current !== null &&
      current.uri === expected.uri &&
      current.version === expected.version &&
      current.referenceKey === expected.referenceKey &&
      current.settingsKey === expected.settingsKey
    );
  }

  private timeoutDiagnostics(input: PrologDiagnosticsInput, timeoutMs: number): Diagnostic[] {
    const source = [timeoutDiagnostic(timeoutMs)];
    return input.references.flatMap((ref) =>
      this.analyzer.prologSourceDiagnosticsToDiagnostics(ref, source),
    );
  }

  private failureDiagnostics(
    references: readonly PrologFileReference[],
    error: unknown,
  ): Diagnostic[] {
    const source = [providerFailureDiagnostic(error)];
    return references.flatMap((ref) =>
      this.analyzer.prologSourceDiagnosticsToDiagnostics(ref, source),
    );
  }

  private finishWithDiagnostics(
    input: PrologDiagnosticsInput,
    generation: number,
    diagnostics: readonly Diagnostic[],
  ): void {
    const state = this.states.get(input.uri);
    if (state?.generation !== generation) return;
    this.states.delete(input.uri);
    const current = this.analyzer.prologDiagnosticsInput(input.uri);
    if (!this.sameInput(input, current)) return;
    this.analyzer.setPrologBridgeDiagnostics(
      input.uri,
      input.version,
      input.referenceKey,
      input.settingsKey,
      diagnostics,
    );
    publishOrRefreshDiagnostics(this.analyzer, input.uri, this.options.getSettings(), this.options);
  }
}
