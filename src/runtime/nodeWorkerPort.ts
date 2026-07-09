// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { parentPort } from "node:worker_threads";
import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { errorResponse } from "./workerShared.js";

// Serve one request per worker through Node worker_threads, folding a thrown error into the wire shape
// instead of crashing the thread.
export function serveNodeWorker(
  run: (request: GuardedEvaluationWorkerRequest) => Promise<GuardedEvaluationWorkerResponse>,
): void {
  parentPort?.on("message", (request: GuardedEvaluationWorkerRequest) => {
    void run(request)
      .then((response) => parentPort?.postMessage(response))
      .catch((error: unknown) => {
        parentPort?.postMessage(errorResponse(error));
      });
  });
}
