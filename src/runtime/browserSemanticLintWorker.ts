// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import {
  runSemanticLintJob,
  type SemanticLintWorkerRequest,
  type SemanticLintWorkerResponse,
} from "./semanticLintShared.js";

interface BrowserSemanticLintWorkerScope {
  onmessage: ((event: MessageEvent<SemanticLintWorkerRequest>) => void) | null;
  postMessage(message: SemanticLintWorkerResponse): void;
}

const scope = globalThis as unknown as BrowserSemanticLintWorkerScope;
scope.onmessage = (event) => {
  scope.postMessage(runSemanticLintJob(event.data));
};
