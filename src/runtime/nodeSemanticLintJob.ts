// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { Worker } from "node:worker_threads";
import type { SemanticLintJob, SemanticLintJobFactory } from "./semanticLintJob.js";
import type {
  SemanticLintWorkerRequest,
  SemanticLintWorkerResponse,
} from "./semanticLintShared.js";
import { resolveRuntimeWorkerUrl } from "./workerUrl.js";

export const createNodeSemanticLintJob: SemanticLintJobFactory = (
  request: SemanticLintWorkerRequest,
): SemanticLintJob => {
  let cancelled = false;
  let settled = false;
  let resolveCancelled: () => void = () => undefined;
  const worker = new Worker(
    resolveRuntimeWorkerUrl("../runtime/semanticLintWorker.js", import.meta.url),
    { execArgv: [] },
  );
  const response = new Promise<SemanticLintWorkerResponse>((resolve, reject) => {
    const resolveOnce = (message: SemanticLintWorkerResponse): void => {
      if (settled) return;
      settled = true;
      resolve(message);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    resolveCancelled = () => resolveOnce({ ok: false, error: "cancelled" });
    worker.once("message", (message: SemanticLintWorkerResponse) => resolveOnce(message));
    worker.once("error", (error) => rejectOnce(error));
    worker.once("exit", (code) => {
      if (cancelled) {
        resolveOnce({ ok: false, error: "cancelled" });
        return;
      }
      if (code !== 0) rejectOnce(new Error(`Semantic lint worker exited with code ${code}.`));
    });
  });
  worker.postMessage(request);
  return {
    response,
    cancel: () => {
      cancelled = true;
      if (!settled) {
        // A cancelled scheduler state ignores this response, but settling it releases the `.then` closures
        // attached by the scheduler instead of retaining stale source text until process exit.
        resolveCancelled();
        void worker.terminate();
        return;
      }
      worker.terminate().catch(() => undefined);
    },
  };
};
