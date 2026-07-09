// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { parentPort } from "node:worker_threads";
import {
  runSemanticLintJob,
  type SemanticLintWorkerRequest,
  type SemanticLintWorkerResponse,
} from "./semanticLintShared.js";

export type { SemanticLintWorkerRequest, SemanticLintWorkerResponse };
export { runSemanticLintJob };

const port = parentPort;
port?.on("message", (request: SemanticLintWorkerRequest) => {
  port.postMessage(runSemanticLintJob(request));
  port.close();
});
