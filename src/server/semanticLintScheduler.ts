// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";
import type { SemanticLintJob, SemanticLintJobFactory } from "../runtime/semanticLintJob.js";
import type { SemanticLintWorkerRequest } from "../runtime/semanticLintShared.js";
import type { Analyzer, SemanticLintInput } from "./analyzer.js";
import {
  type DebouncedDiagnosticState,
  DiagnosticInputScheduler,
  publishOrRefreshDiagnostics,
  unrefTimer,
} from "./diagnosticSchedulerUtils.js";
import type { DiagnosticSettings } from "./types.js";

export interface SemanticLintSchedulerOptions {
  readonly debounceMs?: number;
  readonly timeoutMs?: number;
  readonly maxConcurrentJobs?: number;
  readonly getSettings: () => DiagnosticSettings;
  readonly pullDiagnostics: () => boolean;
  readonly publishDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
  readonly refreshDiagnostics: () => void;
  readonly createJob: SemanticLintJobFactory;
  readonly logError?: (message: string) => void;
}

interface ScheduledState extends DebouncedDiagnosticState {
  readonly generation: number;
  readonly timer?: ReturnType<typeof setTimeout>;
  readonly job?: SemanticLintJob;
}

interface QueuedJob {
  readonly uri: string;
  readonly generation: number;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_CONCURRENT_JOBS = 2;

function topOfFileWarning(message: string, code: string): Diagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    message,
    severity: DiagnosticSeverity.Warning,
    source: "metta-semantic-lint",
    code,
  };
}

export class SemanticLintScheduler {
  private readonly states = new Map<string, ScheduledState>();
  private readonly queue: QueuedJob[] = [];
  private readonly debounceMs: number;
  private readonly timeoutMs: number;
  private readonly maxConcurrentJobs: number;
  private readonly inputScheduler: DiagnosticInputScheduler<SemanticLintInput, ScheduledState>;
  private runningJobs = 0;

  public constructor(
    private readonly analyzer: Analyzer,
    private readonly options: SemanticLintSchedulerOptions,
  ) {
    this.debounceMs = Math.max(0, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxConcurrentJobs = Math.max(1, options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS);
    this.inputScheduler = new DiagnosticInputScheduler({
      states: this.states,
      debounceMs: () => this.debounceMs,
      hasFresh: (uri) => this.analyzer.hasFreshSemanticLintDiagnostics(uri),
      input: (uri) => this.analyzer.semanticLintInput(uri),
      cancel: (uri) => this.cancel(uri),
      clear: (uri) => this.analyzer.clearSemanticLintDiagnostics(uri),
      start: (input, generation) => this.start(input, generation),
    });
  }

  public schedule(uri: string): void {
    this.inputScheduler.schedule(uri, this.options.getSettings().semanticLint);
  }

  public scheduleAll(uris: readonly string[]): void {
    for (const uri of uris) this.schedule(uri);
  }

  public cancel(uri: string): void {
    const state = this.states.get(uri);
    if (state?.timer !== undefined) clearTimeout(state.timer);
    state?.job?.cancel();
    this.states.delete(uri);
  }

  public dispose(): void {
    for (const uri of this.states.keys()) this.cancel(uri);
    this.queue.length = 0;
  }

  private start(input: SemanticLintInput, generation: number): void {
    this.queue.push({ uri: input.uri, generation });
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.runningJobs < this.maxConcurrentJobs) {
      const next = this.queue.shift();
      if (next === undefined) return;
      const state = this.states.get(next.uri);
      if (state?.generation !== next.generation || state.job !== undefined) continue;
      const input = this.analyzer.semanticLintInput(next.uri);
      if (input === null) {
        this.finishStale(next.uri, next.generation);
        continue;
      }
      this.startJob(input, next.generation);
    }
  }

  private startJob(input: SemanticLintInput, generation: number): void {
    const current = this.analyzer.semanticLintInput(input.uri);
    if (!this.sameInput(input, current)) {
      this.finishStale(input.uri, generation);
      return;
    }
    const request = {
      source: input.text,
      severities: input.severities,
    } satisfies SemanticLintWorkerRequest;
    const job = this.options.createJob(request);
    this.runningJobs += 1;
    this.states.set(input.uri, { generation, job });
    const timeout = setTimeout(() => {
      job.cancel();
      this.finishWithDiagnostics(input, generation, [
        topOfFileWarning(
          `Semantic lint timed out after ${this.timeoutMs} ms; static diagnostics are still current.`,
          "semantic-lint.timeout",
        ),
      ]);
    }, this.timeoutMs);
    unrefTimer(timeout);
    job.response
      .then((response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          this.finishWithDiagnostics(input, generation, [
            topOfFileWarning(
              `Semantic lint failed: ${response.error ?? "unknown error"}.`,
              "semantic-lint.error",
            ),
          ]);
          return;
        }
        const currentInput = this.analyzer.semanticLintInput(input.uri);
        if (!this.sameInput(input, currentInput)) {
          this.finishStale(input.uri, generation);
          return;
        }
        const diagnostics = this.analyzer.semanticLintViolationsToDiagnostics(
          input.uri,
          response.violations ?? [],
        );
        this.finishWithDiagnostics(input, generation, diagnostics);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        this.options.logError?.(`semantic lint worker failed: ${String(error)}`);
        this.finishWithDiagnostics(input, generation, [
          topOfFileWarning(
            `Semantic lint failed: ${error instanceof Error ? error.message : String(error)}.`,
            "semantic-lint.error",
          ),
        ]);
      })
      .finally(() => {
        this.runningJobs = Math.max(0, this.runningJobs - 1);
        this.drainQueue();
      });
  }

  private sameInput(
    expected: SemanticLintInput,
    current: SemanticLintInput | null,
  ): current is SemanticLintInput {
    return (
      current !== null &&
      current.uri === expected.uri &&
      current.version === expected.version &&
      current.sourceFingerprint === expected.sourceFingerprint &&
      current.severityKey === expected.severityKey
    );
  }

  private finishStale(uri: string, generation: number): void {
    const state = this.states.get(uri);
    if (state?.generation !== generation) return;
    this.states.delete(uri);
  }

  private finishWithDiagnostics(
    input: SemanticLintInput,
    generation: number,
    diagnostics: readonly Diagnostic[],
  ): void {
    const state = this.states.get(input.uri);
    if (state?.generation !== generation) return;
    this.states.delete(input.uri);
    const current = this.analyzer.semanticLintInput(input.uri);
    if (!this.sameInput(input, current)) return;
    this.analyzer.setSemanticLintDiagnostics(
      input.uri,
      input.version,
      input.sourceFingerprint,
      input.severityKey,
      diagnostics,
    );
    publishOrRefreshDiagnostics(this.analyzer, input.uri, this.options.getSettings(), this.options);
  }
}
