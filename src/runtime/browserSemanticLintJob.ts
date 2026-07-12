// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { relatedBrowserWorkerUrl } from "./browserWorkerUrl.js";
import type { SemanticLintJob, SemanticLintJobFactory } from "./semanticLintJob.js";
import type {
  SemanticLintWorkerRequest,
  SemanticLintWorkerResponse,
} from "./semanticLintShared.js";

function defaultWorkerUrl(): URL {
  return relatedBrowserWorkerUrl("../runtime/browserSemanticLintWorker.js");
}

export function createBrowserSemanticLintJobFactory(
  workerUrl = defaultWorkerUrl(),
): SemanticLintJobFactory {
  return (request: SemanticLintWorkerRequest): SemanticLintJob => {
    const worker = new Worker(workerUrl, { type: "module" });
    const response = new Promise<SemanticLintWorkerResponse>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<SemanticLintWorkerResponse>) => resolve(event.data);
      worker.onerror = (event) => {
        reject(
          new Error(event.message === "" ? "Browser semantic lint worker failed." : event.message),
        );
      };
    });
    worker.postMessage(request);
    return {
      response,
      cancel: () => {
        worker.terminate();
      },
    };
  };
}
