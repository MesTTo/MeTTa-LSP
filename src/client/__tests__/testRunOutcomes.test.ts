// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { testRunOutcomes } from "../testRunOutcomes.js";

describe("testRunOutcomes", () => {
  it("maps assertion results to Test Explorer states", () => {
    expect(
      testRunOutcomes(2, {
        ok: true,
        truncated: false,
        queries: [
          {
            query: "(assertEqual (+ 1 1) 2)",
            results: ["()"],
            resultCount: 1,
            truncated: false,
          },
          {
            query: "(assertEqual (+ 1 1) 3)",
            results: ["(Error assertion failed)"],
            resultCount: 1,
            truncated: false,
          },
        ],
      }),
    ).toStrictEqual([
      { status: "passed" },
      { status: "failed", message: "(Error assertion failed)" },
    ]);
  });

  it("reports omitted truncated results as errors", () => {
    expect(
      testRunOutcomes(2, {
        ok: true,
        truncated: true,
        queries: [
          {
            query: "(assertEqual 1 1)",
            results: ["()"],
            resultCount: 1,
            truncated: false,
          },
        ],
      }),
    ).toStrictEqual([
      { status: "passed" },
      { status: "errored", message: "result omitted by guard limits" },
    ]);
  });

  it("reports an unexplained missing result as an error", () => {
    expect(
      testRunOutcomes(1, {
        ok: true,
        truncated: false,
        queries: [],
      }),
    ).toStrictEqual([{ status: "errored", message: "evaluation did not return a result" }]);
  });

  it("reports unavailable and failed evaluation instead of skipping tests", () => {
    expect(testRunOutcomes(1, undefined)).toStrictEqual([
      { status: "errored", message: "language client unavailable" },
    ]);
    expect(
      testRunOutcomes(1, { ok: false, error: "worker failed", queries: [], truncated: false }),
    ).toStrictEqual([{ status: "errored", message: "worker failed" }]);
  });
});
