// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { errorResponse } from "./workerShared.js";

interface BrowserWorkerScope {
  onmessage: ((event: MessageEvent<GuardedEvaluationWorkerRequest>) => void) | null;
  postMessage(message: GuardedEvaluationWorkerResponse): void;
}

export function serveBrowserWorker(
  run: (request: GuardedEvaluationWorkerRequest) => Promise<GuardedEvaluationWorkerResponse>,
): void {
  const scope = globalThis as unknown as BrowserWorkerScope;
  scope.onmessage = (event) => {
    void run(event.data)
      .then((response) => scope.postMessage(response))
      .catch((error: unknown) => scope.postMessage(errorResponse(error)));
  };
}
