// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Shared machinery for evaluation workers: capture core's output sinks under the byte cap, convert
// caller-injected import sources to atom lists, and fold raw query results into the bounded wire shape. This
// module is browser-safe; Node and browser workers attach their own message transport at the edge.

import type { Atom, QueryResult } from "@metta-ts/core";
import type {
  GuardedEvaluationPolicy,
  GuardedEvaluationWorkerResponse,
  GuardedQueryResult,
} from "../server/guardedEvaluationTypes.js";

type Core = typeof import("@metta-ts/core");

function appendLimited(
  current: string,
  addition: string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (maxChars <= 0) return { value: "", truncated: addition.length > 0 || current.length > 0 };
  const next = current + addition;
  if (next.length <= maxChars) return { value: next, truncated: false };
  return { value: next.slice(0, maxChars), truncated: true };
}

export interface OutputCapture {
  text(): string;
  truncated(): boolean;
  restore(): void;
}

// Route core's println!/raw output into a capped buffer instead of the host's stdio.
export function captureOutput(core: Core, maxOutputChars: number): OutputCapture {
  let stdout = "";
  let truncated = false;
  const previousLine = core.setOutputSink((line: string) => {
    const appended = appendLimited(stdout, `${line}\n`, maxOutputChars);
    stdout = appended.value;
    truncated ||= appended.truncated;
  });
  const previousRaw = core.setRawSink((text: string) => {
    const appended = appendLimited(stdout, text, maxOutputChars);
    stdout = appended.value;
    truncated ||= appended.truncated;
  });
  return {
    text: () => stdout,
    truncated: () => truncated,
    restore: () => {
      core.setOutputSink(previousLine);
      core.setRawSink(previousRaw);
    },
  };
}

// The injected import map, parsed: module name → its atoms, the shape core's import! resolves.
export function importsAsAtoms(
  core: Core,
  imports: Readonly<Record<string, string>>,
): Map<string, Atom[]> {
  const converted = new Map<string, Atom[]>();
  for (const [name, source] of Object.entries(imports)) {
    converted.set(
      name,
      core.parseAll(source, core.standardTokenizer()).map((top) => top.atom),
    );
  }
  return converted;
}

// Fold raw query results into the response, applying the policy's result caps.
export function collectResponse(
  core: Core,
  raw: readonly QueryResult[],
  policy: GuardedEvaluationPolicy,
  output: OutputCapture,
): GuardedEvaluationWorkerResponse {
  let truncated = output.truncated();
  let resultChars = 0;
  const queries: GuardedQueryResult[] = [];
  for (const query of raw.slice(0, policy.maxResults)) {
    const formattedResults: string[] = [];
    let queryTruncated = false;
    for (const atom of query.results) {
      const formatted = core.format(atom);
      if (resultChars + formatted.length > policy.maxResultChars) {
        queryTruncated = true;
        truncated = true;
        break;
      }
      resultChars += formatted.length;
      formattedResults.push(formatted);
    }
    queries.push({
      query: core.format(query.query),
      results: formattedResults,
      resultCount: query.results.length,
      truncated: queryTruncated || formattedResults.length < query.results.length,
    });
    if (truncated) break;
  }
  if (raw.length > queries.length) truncated = true;
  return { ok: true, queries, stdout: output.text(), stderr: "", truncated };
}

export function errorResponse(error: unknown): GuardedEvaluationWorkerResponse {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    stdout: "",
    stderr: "",
    truncated: false,
  };
}
