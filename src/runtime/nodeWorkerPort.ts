// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { parentPort } from "node:worker_threads";
import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { errorResponse } from "./workerShared.js";

interface CancelWorkerMessage {
  readonly type: "cancel";
}

interface WorkerCancelledMessage {
  readonly type: "cancelled";
}

export const CANCEL_WORKER_MESSAGE: CancelWorkerMessage = { type: "cancel" };
export const WORKER_CANCELLED_MESSAGE: WorkerCancelledMessage = { type: "cancelled" };

export interface NodeWorkerServerOptions {
  readonly cancel?: () => void | Promise<void>;
}

function isCancelWorkerMessage(message: unknown): message is CancelWorkerMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === CANCEL_WORKER_MESSAGE.type
  );
}

export function isWorkerCancelledMessage(message: unknown): message is WorkerCancelledMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === WORKER_CANCELLED_MESSAGE.type
  );
}

// Serve one request per worker through Node worker_threads, folding a thrown error into the wire shape
// instead of crashing the thread.
export function serveNodeWorker(
  run: (request: GuardedEvaluationWorkerRequest) => Promise<GuardedEvaluationWorkerResponse>,
  options: NodeWorkerServerOptions = {},
): void {
  let cancelled = false;
  parentPort?.on("message", (request: GuardedEvaluationWorkerRequest | CancelWorkerMessage) => {
    if (isCancelWorkerMessage(request)) {
      if (cancelled) return;
      cancelled = true;
      void Promise.resolve()
        .then(() => options.cancel?.())
        .catch(() => undefined)
        .then(() => {
          parentPort?.postMessage(WORKER_CANCELLED_MESSAGE);
          parentPort?.close();
        });
      return;
    }
    void run(request)
      .then((response) => {
        if (!cancelled) parentPort?.postMessage(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) parentPort?.postMessage(errorResponse(error));
      });
  });
}
