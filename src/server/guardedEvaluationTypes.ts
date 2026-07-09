// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Neutral (browser-safe) type surface for guarded evaluation. These interfaces describe the LSP request
// and result shapes, so they are shared by the pure request layer (shared/lspRequests) and the node
// executor (runtime/guardedEvaluation) alike. Keeping them free of node builtins lets the client and the
// pure core reference them without pulling node:worker_threads/node:crypto. The node executor and its
// worker live in runtime/; only the vocabulary lives here.
//
// Safety is object-capability, not source-scanning. Guarded workers evaluate through @metta-ts/core plus the
// source-only platform runner: @metta-ts/node/source on Node, @metta-ts/browser/source in browser workers.
// Both runners accept only an in-memory import map. Core host effects are disabled in the main guarded worker
// and in hyperpose branch workers, so fileio/git-import! reduce to inert Error atoms. The root @metta-ts/node
// file helpers, hyperon js-atom bridge, DAS network client, and Python bridge are absent. import! resolves
// only caller-injected sources from the in-memory index, never disk. The policy therefore carries resource
// bounds only; fuel is the hard step ceiling no in-language pragma! can raise. The UNGUARDED worker is the
// deliberate exception: it may add host interops such as @metta-ts/py pythonia or @metta-ts/prolog SWI when
// the source uses those heads, which is why the guarded and unguarded runs use separate worker files.

import type { ParseDiagnostic } from "./types.js";

export type EvaluationEngine = "metta-ts-core" | "off";

export interface GuardedEvaluationPolicy {
  readonly enabled: boolean;
  readonly engine: EvaluationEngine;
  readonly fuel: number;
  readonly timeoutMs: number;
  readonly maxSourceBytes: number;
  readonly maxResults: number;
  readonly maxResultChars: number;
  readonly maxOutputChars: number;
  readonly maxStackDepth: number;
  readonly tabling: boolean;
  readonly experimental: {
    readonly hashCons: boolean;
    readonly trail: boolean;
    readonly flatAtomspace: boolean;
  };
}

export interface GuardedEvaluationRequest {
  readonly source: string;
  readonly uri?: string;
  readonly policy?: Partial<GuardedEvaluationPolicy>;
  readonly imports?: Readonly<Record<string, string>>;
  readonly importPaths?: Readonly<Record<string, string>>;
  readonly wrapBareExpression?: boolean;
}

export interface GuardedEvaluationWorkerRequest {
  readonly source: string;
  readonly policy: GuardedEvaluationPolicy;
  readonly imports: Readonly<Record<string, string>>;
  // Ask the unguarded worker to wire the Python bridge (the source uses a py- head). The guarded
  // worker ignores this field entirely: it has no Python code path to enable.
  readonly python?: boolean;
  // Ask the unguarded worker to wire the Prolog bridge (the source uses a Prolog interop head).
  readonly prolog?: boolean;
  readonly importPaths?: Readonly<Record<string, string>>;
}

export interface GuardedQueryResult {
  readonly query: string;
  readonly results: readonly string[];
  readonly resultCount: number;
  readonly truncated: boolean;
}

export interface GuardedEvaluationWorkerResponse {
  readonly ok: boolean;
  readonly queries?: readonly GuardedQueryResult[];
  readonly stdout?: string;
  readonly stderr?: string;
  readonly truncated?: boolean;
  readonly error?: string;
  // Set only by the unguarded worker when the source used py- heads: "live" ran over the pythonia
  // bridge; "unavailable" fell back to plain core (pythonia not installed or python3 missing).
  readonly python?: "live" | "unavailable";
  readonly prolog?: "live" | "unavailable";
}

export interface GuardedEvaluationResult {
  readonly ok: boolean;
  readonly guarded: boolean;
  readonly engine: EvaluationEngine;
  readonly stateless: true;
  readonly sourceHash: string;
  readonly elapsedMs: number;
  readonly policy: GuardedEvaluationPolicy;
  // Non-capability reasons evaluation did not run: disabled, engine off, source over the byte cap, or a
  // syntax error. Side-effect safety needs no scan: the worker registers core plus a source-only runner,
  // with core host effects disabled, so a dangerous grounded atom is absent or inert.
  readonly blockers: readonly string[];
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly queries: readonly GuardedQueryResult[];
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly error?: string;
  // Unguarded runs only: whether host interop forms evaluated over a live backend ("live") or stayed
  // inert because the backend is missing ("unavailable"). Absent for guarded evaluation and for
  // sources that use no matching host heads.
  readonly python?: "live" | "unavailable";
  readonly prolog?: "live" | "unavailable";
}

export const DEFAULT_GUARDED_EVALUATION_POLICY: GuardedEvaluationPolicy = {
  enabled: true,
  engine: "metta-ts-core",
  fuel: 20_000,
  timeoutMs: 1_500,
  maxSourceBytes: 64 * 1024,
  maxResults: 128,
  maxResultChars: 32 * 1024,
  maxOutputChars: 16 * 1024,
  maxStackDepth: 512,
  tabling: true,
  experimental: {
    hashCons: true,
    trail: true,
    flatAtomspace: false,
  },
};
