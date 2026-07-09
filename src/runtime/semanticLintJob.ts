// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type {
  SemanticLintWorkerRequest,
  SemanticLintWorkerResponse,
} from "./semanticLintShared.js";

export interface SemanticLintJob {
  readonly response: Promise<SemanticLintWorkerResponse>;
  cancel(): void;
}

export type SemanticLintJobFactory = (request: SemanticLintWorkerRequest) => SemanticLintJob;
