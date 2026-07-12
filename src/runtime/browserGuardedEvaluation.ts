// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type {
  GuardedEvaluationPolicy,
  GuardedEvaluationRequest,
  GuardedEvaluationResult,
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { wrapBareExpression } from "../server/runnableForms.js";
import { relatedBrowserWorkerUrl } from "./browserWorkerUrl.js";
import {
  emptyEvaluationResult,
  guardedResultFromWorker,
  guardSource,
  mergeGuardedEvaluationPolicy,
} from "./guardedEvaluationShared.js";
import {
  BROWSER_RUNTIME_CAPABILITIES,
  type RuntimeCapabilities,
  type RuntimeHost,
} from "./runtimeHost.js";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return bytesToHex(new Uint8Array(digest));
}

function defaultWorkerUrl(): URL {
  return relatedBrowserWorkerUrl("../runtime/browserEvaluationWorker.js");
}

function runBrowserEvaluationWorker(
  payload: GuardedEvaluationWorkerRequest,
  timeoutMs: number,
  workerUrl = defaultWorkerUrl(),
  signal?: AbortSignal,
): Promise<GuardedEvaluationWorkerResponse> {
  if (signal?.aborted === true) {
    return Promise.resolve({ ok: false, error: "Evaluation cancelled." });
  }
  return new Promise<GuardedEvaluationWorkerResponse>((resolve) => {
    const worker = new Worker(workerUrl, { type: "module" });
    let settled = false;
    const finish = (response: GuardedEvaluationWorkerResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(response);
    };
    const abort = (): void => finish({ ok: false, error: "Evaluation cancelled." });
    const timeout = setTimeout(() => {
      finish({ ok: false, error: `Evaluation timed out after ${timeoutMs} ms.` });
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<GuardedEvaluationWorkerResponse>) => finish(event.data);
    worker.onerror = (event) => {
      finish({
        ok: false,
        error: event.message === "" ? "Browser evaluation worker failed." : event.message,
      });
    };
    worker.postMessage(payload);
  });
}

async function runWithPolicy(
  request: GuardedEvaluationRequest,
  policy: GuardedEvaluationPolicy,
  workerUrl?: URL,
  signal?: AbortSignal,
): Promise<GuardedEvaluationResult> {
  const started = Date.now();
  const source =
    request.wrapBareExpression === false ? request.source : wrapBareExpression(request.source);
  const hash = await sourceHash(source);
  const guard = guardSource(source, request.uri, policy);
  if (guard.blockers.length > 0 || policy.engine === "off" || !policy.enabled) {
    return emptyEvaluationResult(
      hash,
      policy,
      Date.now() - started,
      guard.diagnostics,
      guard.blockers,
    );
  }
  if (typeof Worker === "undefined") {
    return emptyEvaluationResult(
      hash,
      policy,
      Date.now() - started,
      guard.diagnostics,
      ["Browser Web Workers are unavailable."],
      "Browser Web Workers are unavailable.",
    );
  }
  const workerResponse = await runBrowserEvaluationWorker(
    { source, policy, imports: request.imports ?? {} },
    policy.timeoutMs,
    workerUrl,
    signal,
  );
  return guardedResultFromWorker(
    workerResponse,
    hash,
    policy,
    Date.now() - started,
    guard.blockers,
    guard.diagnostics,
    true,
  );
}

export async function evaluateGuardedInBrowser(
  request: GuardedEvaluationRequest,
  workerUrl?: URL,
  signal?: AbortSignal,
): Promise<GuardedEvaluationResult> {
  return runWithPolicy(request, mergeGuardedEvaluationPolicy(request.policy), workerUrl, signal);
}

export class BrowserRuntimeHost implements RuntimeHost {
  public readonly capabilities: RuntimeCapabilities = BROWSER_RUNTIME_CAPABILITIES;

  public constructor(private readonly evaluationWorkerUrl = defaultWorkerUrl()) {}

  public guardedEvaluate(
    request: GuardedEvaluationRequest,
    signal?: AbortSignal,
  ): Promise<GuardedEvaluationResult> {
    return evaluateGuardedInBrowser(request, this.evaluationWorkerUrl, signal);
  }
}
