// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type { LintSeverity, SemanticViolation } from "../language-service/index.js";
import { runSemanticLint } from "../language-service/index.js";

export interface SemanticLintWorkerRequest {
  readonly source: string;
  readonly severities: Readonly<Record<string, LintSeverity>>;
}

export interface SemanticLintWorkerResponse {
  readonly ok: boolean;
  readonly violations?: readonly SemanticViolation[];
  readonly error?: string;
}

export function runSemanticLintJob(request: SemanticLintWorkerRequest): SemanticLintWorkerResponse {
  try {
    return { ok: true, violations: runSemanticLint(request.source, request.severities) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
