// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { classifyTestQueries } from "../language-service/index.js";
import type { GuardedEvaluationResultPayload } from "../server/shared/lspRequests.js";

export interface ExplorerTestOutcome {
  readonly status: "passed" | "failed" | "errored" | "skipped";
  readonly message?: string;
}

type EvaluationResult = Pick<
  GuardedEvaluationResultPayload,
  "error" | "ok" | "queries" | "truncated"
>;

export function testRunOutcomes(
  testCount: number,
  result: EvaluationResult | undefined,
): ExplorerTestOutcome[] {
  if (result === undefined) {
    return Array.from({ length: testCount }, () => ({
      status: "errored",
      message: "language client unavailable",
    }));
  }
  if (!result.ok) {
    return Array.from({ length: testCount }, () => ({
      status: "errored",
      message: result.error ?? "guarded evaluation failed",
    }));
  }
  const classified = classifyTestQueries(result.queries);
  return Array.from({ length: testCount }, (_, index) => {
    const outcome = classified[index];
    if (outcome === undefined) {
      return result.truncated
        ? { status: "errored", message: "result omitted by guard limits" }
        : { status: "errored", message: "evaluation did not return a result" };
    }
    if (outcome.status === "pass") return { status: "passed" };
    if (outcome.status === "fail") {
      return { status: "failed", message: outcome.message ?? "assertion failed" };
    }
    return { status: "errored", message: outcome.message ?? "unexpected result" };
  });
}
