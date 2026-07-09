// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { DiagnosticSeverity, type Range } from "vscode-languageserver-types";
import { PROLOG_OP_NAMES, PY_OP_NAMES } from "../server/builtins.js";
import {
  DEFAULT_GUARDED_EVALUATION_POLICY,
  type GuardedEvaluationPolicy,
  type GuardedEvaluationResult,
  type GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { offsetAt, parseMeTTa, rangeFromOffsets } from "../server/parser.js";
import type { ParseDiagnostic } from "../server/types.js";

export function clonePolicy(policy: GuardedEvaluationPolicy): GuardedEvaluationPolicy {
  return {
    ...policy,
    experimental: { ...policy.experimental },
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function mergeGuardedEvaluationPolicy(
  policy?: Partial<GuardedEvaluationPolicy>,
): GuardedEvaluationPolicy {
  const merged: GuardedEvaluationPolicy = {
    ...DEFAULT_GUARDED_EVALUATION_POLICY,
    ...(policy ?? {}),
    experimental: {
      ...DEFAULT_GUARDED_EVALUATION_POLICY.experimental,
      ...(policy?.experimental ?? {}),
    },
  };
  return {
    ...merged,
    fuel: clampInteger(merged.fuel, 1, 1_000_000),
    timeoutMs: clampInteger(merged.timeoutMs, 50, 30_000),
    maxSourceBytes: clampInteger(merged.maxSourceBytes, 1, 2 * 1024 * 1024),
    maxResults: clampInteger(merged.maxResults, 1, 10_000),
    maxResultChars: clampInteger(merged.maxResultChars, 1, 2 * 1024 * 1024),
    maxOutputChars: clampInteger(merged.maxOutputChars, 0, 2 * 1024 * 1024),
    maxStackDepth: clampInteger(merged.maxStackDepth, 16, 20_000),
  };
}

function utf8Bytes(source: string): number {
  return new TextEncoder().encode(source).byteLength;
}

// Pre-flight the source. These are the only reasons evaluation is withheld, and none is a side-effect scan:
// worker imports define capability. What remains is whether evaluation is enabled, whether the engine is on,
// whether the source fits the byte cap, and whether it parses.
export function guardSource(
  source: string,
  uri = "metta://guarded-evaluation/input",
  policy = DEFAULT_GUARDED_EVALUATION_POLICY,
): {
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly blockers: readonly string[];
} {
  const parsed = parseMeTTa(uri, source, null);
  const blockers: string[] = [];

  if (!policy.enabled) blockers.push("Guarded evaluation is disabled by policy.");
  if (policy.engine === "off") blockers.push("Evaluation engine is set to off.");
  const byteLength = utf8Bytes(source);
  if (byteLength > policy.maxSourceBytes)
    blockers.push(`Source is ${byteLength} bytes; guard limit is ${policy.maxSourceBytes} bytes.`);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error))
    blockers.push("Source has syntax errors; evaluation is blocked until the parse is clean.");

  return { diagnostics: parsed.diagnostics, blockers };
}

export function sliceSourceByRange(source: string, range?: Range): string {
  if (!range) return source;
  const parsed = parseMeTTa("metta://guarded-evaluation/slice", source, null);
  const start = offsetAt(range.start, parsed.lineOffsets, source.length);
  const end = offsetAt(range.end, parsed.lineOffsets, source.length);
  return source.slice(Math.max(0, start), Math.max(0, end));
}

export function normalizeEvaluationRange(source: string, range?: Range): Range | undefined {
  if (!range) return undefined;
  const parsed = parseMeTTa("metta://guarded-evaluation/range", source, null);
  const start = offsetAt(range.start, parsed.lineOffsets, source.length);
  const end = offsetAt(range.end, parsed.lineOffsets, source.length);
  return rangeFromOffsets(Math.max(0, start), Math.max(0, end), parsed.lineOffsets);
}

export function emptyEvaluationResult(
  sourceHash: string,
  policy: GuardedEvaluationPolicy,
  elapsedMs: number,
  diagnostics: readonly ParseDiagnostic[],
  blockers: readonly string[],
  error?: string,
): GuardedEvaluationResult {
  return {
    ok: false,
    guarded: true,
    engine: policy.engine,
    stateless: true,
    sourceHash,
    elapsedMs,
    policy: clonePolicy(policy),
    blockers,
    diagnostics,
    queries: [],
    stdout: "",
    stderr: "",
    truncated: false,
    error,
  };
}

export function evaluatorOptionsForPolicy(policy: GuardedEvaluationPolicy): {
  readonly tabling: boolean;
  readonly maxStackDepth: number;
  readonly experimental: GuardedEvaluationPolicy["experimental"];
} {
  return {
    tabling: policy.tabling,
    maxStackDepth: policy.maxStackDepth,
    experimental: policy.experimental,
  };
}

export function guardedResultFromWorker(
  workerResponse: GuardedEvaluationWorkerResponse,
  sourceHash: string,
  policy: GuardedEvaluationPolicy,
  elapsedMs: number,
  blockers: readonly string[],
  diagnostics: readonly ParseDiagnostic[],
  guarded: boolean,
): GuardedEvaluationResult {
  return {
    ok: workerResponse.ok,
    guarded,
    engine: policy.engine,
    stateless: true,
    sourceHash,
    elapsedMs,
    policy: clonePolicy(policy),
    blockers,
    diagnostics,
    queries: workerResponse.queries ?? [],
    stdout: workerResponse.stdout ?? "",
    stderr: workerResponse.stderr ?? "",
    truncated: workerResponse.truncated === true,
    error: workerResponse.error,
    ...(workerResponse.python !== undefined ? { python: workerResponse.python } : {}),
    ...(workerResponse.prolog !== undefined ? { prolog: workerResponse.prolog } : {}),
  };
}

function sourceUsesAny(source: string, names: ReadonlySet<string>): boolean {
  return parseMeTTa("metta://unguarded-run/host-scan", source, null).tokens.some(
    (token) => token.type === "symbol" && names.has(token.text),
  );
}

// True when the program mentions one of the Python interop heads as a symbol, so the unguarded run wires the
// pythonia bridge only for programs that can use it. Token-based, so comments and strings do not count.
export function sourceUsesPython(source: string): boolean {
  return sourceUsesAny(source, PY_OP_NAMES);
}

// True when the program mentions one of the Prolog interop heads as a symbol, so explicit Run wires SWI only
// for programs that can use it.
export function sourceUsesProlog(source: string): boolean {
  return sourceUsesAny(source, PROLOG_OP_NAMES);
}
