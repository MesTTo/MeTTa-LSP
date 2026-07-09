// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type { Diagnostic } from "vscode-languageserver-types";
import type { Analyzer } from "./analyzer.js";
import type { DiagnosticSettings } from "./types.js";

export interface DebouncedDiagnosticState {
  readonly generation: number;
  readonly timer?: ReturnType<typeof setTimeout>;
}

export interface DiagnosticPublishOptions {
  readonly pullDiagnostics: () => boolean;
  readonly publishDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
  readonly refreshDiagnostics: () => void;
}

export interface DiagnosticInputSchedulerOptions<TInput extends { readonly uri: string }, TState> {
  readonly states: Map<string, TState & DebouncedDiagnosticState>;
  readonly debounceMs: () => number;
  readonly hasFresh: (uri: string) => boolean;
  readonly input: (uri: string) => TInput | null;
  readonly cancel: (uri: string) => void;
  readonly clear: (uri: string) => void;
  readonly start: (input: TInput, generation: number) => void;
}

export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

export function scheduleDebounced<T extends DebouncedDiagnosticState>(
  states: Map<string, T>,
  uri: string,
  debounceMs: number,
  cancel: (uri: string) => void,
  start: (generation: number) => void,
): void {
  const generation = (states.get(uri)?.generation ?? 0) + 1;
  cancel(uri);
  const timer = setTimeout(() => start(generation), debounceMs);
  unrefTimer(timer);
  states.set(uri, { generation, timer } as T);
}

export function clearDebouncedState<T extends DebouncedDiagnosticState>(
  states: Map<string, T>,
  uri: string,
): void {
  const state = states.get(uri);
  if (state?.timer !== undefined) clearTimeout(state.timer);
  states.delete(uri);
}

export function disposeDebouncedStates(
  states: ReadonlyMap<string, DebouncedDiagnosticState>,
  cancel: (uri: string) => void,
): void {
  for (const uri of states.keys()) cancel(uri);
}

export class DiagnosticInputScheduler<
  TInput extends { readonly uri: string },
  TState extends DebouncedDiagnosticState,
> {
  public constructor(private readonly options: DiagnosticInputSchedulerOptions<TInput, TState>) {}

  public schedule(uri: string, enabled: boolean): void {
    if (!enabled) {
      this.options.cancel(uri);
      this.options.clear(uri);
      return;
    }
    if (this.options.hasFresh(uri)) return;
    const input = this.options.input(uri);
    if (input === null) {
      this.options.cancel(uri);
      this.options.clear(uri);
      return;
    }
    scheduleDebounced(
      this.options.states,
      input.uri,
      this.options.debounceMs(),
      this.options.cancel,
      (generation) => this.options.start(input, generation),
    );
  }
}

export function createDiagnosticInputScheduler<
  TInput extends { readonly uri: string },
  TState extends DebouncedDiagnosticState,
>(
  states: Map<string, TState>,
  debounceMs: () => number,
  hasFresh: (uri: string) => boolean,
  input: (uri: string) => TInput | null,
  cancel: (uri: string) => void,
  clear: (uri: string) => void,
  start: (input: TInput, generation: number) => void,
): DiagnosticInputScheduler<TInput, TState> {
  return new DiagnosticInputScheduler({
    states,
    debounceMs,
    hasFresh,
    input,
    cancel,
    clear,
    start,
  });
}

export function publishOrRefreshDiagnostics(
  analyzer: Analyzer,
  uri: string,
  settings: DiagnosticSettings,
  options: DiagnosticPublishOptions,
): void {
  if (options.pullDiagnostics()) {
    options.refreshDiagnostics();
    return;
  }
  options.publishDiagnostics(uri, analyzer.validate(uri, settings));
}
