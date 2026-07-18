// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Shared adapter from MeTTa-LSP's already-resolved document imports to @metta-ts/debug's host-free trace
// engine. The debug package accepts an injected runner; this module supplies @metta-ts/node's in-memory
// `runSource`, after inlining import source text the same way the grapher session does.

import { setOutputSink, setRawSink } from "@metta-ts/core";
import {
  assembleQuery,
  collectTrace,
  explainCall,
  summarize,
  type TraceEvent,
  type TraceSummary,
} from "@metta-ts/debug";

type RunSource = typeof import("@metta-ts/node")["runSource"];

export interface EngineTraceDetails {
  readonly trace: readonly TraceEvent[];
  readonly summary: TraceSummary;
}

export interface EngineTraceExplanation extends EngineTraceDetails {
  readonly result: readonly string[];
}

function inlineImportSources(
  source: string,
  imports: Readonly<Record<string, string>> = {},
): string {
  const parts = [...new Set(Object.values(imports).filter((value) => value.trim().length > 0))];
  parts.push(source);
  return parts.join("\n");
}

async function loadRunSource(feature: string): Promise<RunSource> {
  try {
    return (await import("@metta-ts/node")).runSource;
  } catch {
    throw new Error(`metta ${feature} requires the optional @metta-ts/node package.`);
  }
}

function discardInterpreterOutput<T>(fn: () => T): T {
  const restoreOutput = setOutputSink(() => {});
  const restoreRaw = setRawSink(() => {});
  try {
    return fn();
  } finally {
    setOutputSink(restoreOutput);
    setRawSink(restoreRaw);
  }
}

function debugOptions(fuel: number | undefined): { readonly fuel: number } | undefined {
  return fuel === undefined ? undefined : { fuel };
}

export async function explainMettaCall(
  source: string,
  call: string,
  imports: Readonly<Record<string, string>> = {},
  fuel?: number,
): Promise<EngineTraceExplanation> {
  const runSource = await loadRunSource("why");
  return discardInterpreterOutput(() => {
    const explanation = explainCall(
      runSource,
      inlineImportSources(source, imports),
      call,
      debugOptions(fuel),
    );
    return {
      result: explanation.result,
      trace: explanation.trace,
      summary: explanation.summary,
    };
  });
}

export async function collectMettaEngineTrace(
  source: string,
  call: string,
  imports: Readonly<Record<string, string>> = {},
  fuel?: number,
): Promise<EngineTraceDetails> {
  const runSource = await loadRunSource("debug");
  return discardInterpreterOutput(() => {
    const trace = collectTrace(
      runSource,
      assembleQuery(inlineImportSources(source, imports), call),
      debugOptions(fuel),
    );
    return { trace, summary: summarize(trace) };
  });
}
