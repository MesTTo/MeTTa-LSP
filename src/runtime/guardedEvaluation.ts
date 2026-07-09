import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import type {
  GuardedEvaluationPolicy,
  GuardedEvaluationRequest,
  GuardedEvaluationResult,
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { wrapBareExpression } from "../server/runnableForms.js";

export {
  guardSource,
  mergeGuardedEvaluationPolicy,
  normalizeEvaluationRange,
  sliceSourceByRange,
  sourceUsesProlog,
  sourceUsesPython,
} from "./guardedEvaluationShared.js";

import {
  emptyEvaluationResult,
  guardedResultFromWorker,
  guardSource,
  mergeGuardedEvaluationPolicy,
  sourceUsesProlog,
  sourceUsesPython,
} from "./guardedEvaluationShared.js";
import { resolveRuntimeWorkerUrl } from "./workerUrl.js";

function sourceHash(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

// dist mirrors src, so the compiled worker is a sibling of this module; resolve it relative to this module's
// URL (ESM has no __dirname). The guarded worker is always isolated (no fs/network/process capability), so
// this runs any policy safely; the unguarded worker adds only requested host interops. A runaway is bounded
// by `timeoutMs`, after which the worker is terminated.
async function runEvaluationWorker(
  payload: GuardedEvaluationWorkerRequest,
  timeoutMs: number,
  workerFile: string,
): Promise<GuardedEvaluationWorkerResponse> {
  const worker = new Worker(resolveRuntimeWorkerUrl(workerFile, import.meta.url), { execArgv: [] });
  return new Promise<GuardedEvaluationWorkerResponse>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => undefined);
      resolve({ ok: false, error: `Evaluation timed out after ${timeoutMs} ms.` });
    }, timeoutMs);
    worker.once("message", (message: GuardedEvaluationWorkerResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate().catch(() => undefined);
      resolve(message);
    });
    worker.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        error: `Evaluation worker exited before responding with code ${code}.`,
      });
    });
    worker.postMessage(payload);
  });
}

async function runWithPolicy(
  request: GuardedEvaluationRequest,
  policy: GuardedEvaluationPolicy,
  guarded: boolean,
): Promise<GuardedEvaluationResult> {
  const started = Date.now();
  const source =
    request.wrapBareExpression === false ? request.source : wrapBareExpression(request.source);
  const hash = sourceHash(source);
  const guard = guardSource(source, request.uri, policy);
  if (guard.blockers.length > 0 || policy.engine === "off" || !policy.enabled) {
    return {
      ...emptyEvaluationResult(
        hash,
        policy,
        Date.now() - started,
        guard.diagnostics,
        guard.blockers,
      ),
      guarded,
    };
  }
  // The guarded path runs the capability-isolated worker. The unguarded path runs its own worker,
  // which may additionally wire host interops when the program actually uses their heads.
  const python = !guarded && sourceUsesPython(source);
  const prolog = !guarded && sourceUsesProlog(source);
  const workerResponse = await runEvaluationWorker(
    {
      source,
      policy,
      imports: request.imports ?? {},
      importPaths: request.importPaths ?? {},
      ...(python ? { python } : {}),
      ...(prolog ? { prolog } : {}),
    },
    policy.timeoutMs,
    guarded ? "./evaluationWorker.js" : "./unguardedWorker.js",
  );
  return guardedResultFromWorker(
    workerResponse,
    hash,
    policy,
    Date.now() - started,
    guard.blockers,
    guard.diagnostics,
    guarded,
  );
}

export async function evaluateGuarded(
  request: GuardedEvaluationRequest,
): Promise<GuardedEvaluationResult> {
  return runWithPolicy(request, mergeGuardedEvaluationPolicy(request.policy), true);
}

// A billion steps is effectively unlimited for interactive use (not MAX_SAFE_INTEGER, to leave headroom for
// the interpreter's own arithmetic); pragma! sets any real limit. The timeout is a safety net against a
// leaked worker on a non-terminating program, not a resource cap.
const UNGUARDED_FUEL = 1_000_000_000;
const UNGUARDED_CAP = Number.MAX_SAFE_INTEGER;
const UNGUARDED_TIMEOUT_MS = 120_000;

export interface UnguardedRunOptions {
  // The step budget for the run. 0 or omitted means effectively unlimited; a positive value caps it. `pragma!`
  // in the source can tighten it further at the language level.
  readonly fuel?: number;
  // A safety-net timeout that terminates a runaway worker. 0 or omitted uses the default.
  readonly timeoutMs?: number;
}

// Run with no LSP-imposed caps (beyond the configurable fuel/timeout): pragma! governs evaluation. Effect
// safety stays structural (the worker has no fs/network/process capability); the worker keeps the run
// cancellable and non-blocking.
export async function evaluateUnguarded(
  request: GuardedEvaluationRequest,
  options: UnguardedRunOptions = {},
): Promise<GuardedEvaluationResult> {
  const base = mergeGuardedEvaluationPolicy(request.policy);
  const fuel = options.fuel !== undefined && options.fuel > 0 ? options.fuel : UNGUARDED_FUEL;
  const timeoutMs =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? options.timeoutMs
      : UNGUARDED_TIMEOUT_MS;
  const policy: GuardedEvaluationPolicy = {
    ...base,
    enabled: true,
    engine: "metta-ts-core",
    fuel,
    timeoutMs,
    maxSourceBytes: UNGUARDED_CAP,
    maxResults: UNGUARDED_CAP,
    maxResultChars: UNGUARDED_CAP,
    maxOutputChars: UNGUARDED_CAP,
  };
  return runWithPolicy(request, policy, false);
}
