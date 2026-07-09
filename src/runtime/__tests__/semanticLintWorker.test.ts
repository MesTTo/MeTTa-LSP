// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runSemanticLintJob } from "../semanticLintWorker.js";

describe("semantic lint worker", () => {
  it("returns semantic violations without throwing", () => {
    const response = runSemanticLintJob({
      source: "(= (fact $n) (fact (- $n 1)))",
      severities: {},
    });
    expect(response.ok).toBe(true);
    expect(
      response.violations?.some((violation) => violation.rule === "missing-recursive-type"),
    ).toBe(true);
  });

  it("does not keep a Node process alive after posting a worker result", () => {
    const moduleUrl = pathToFileURL(`${process.cwd()}/dist/runtime/nodeSemanticLintJob.js`).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { createNodeSemanticLintJob } from ${JSON.stringify(moduleUrl)};
          const job = createNodeSemanticLintJob({
            source: "(= (fact $n) (fact (- $n 1)))",
            severities: {}
          });
          const response = await job.response;
          if (!response.ok) {
            console.error(response.error ?? "semantic lint failed");
            process.exit(1);
          }
        `,
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    expect(result.error).toBeUndefined();
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "worker exited");
    expect(result.status).toBe(0);
  });

  it("settles cancelled Node worker jobs so stale scheduler closures are released", () => {
    const moduleUrl = pathToFileURL(`${process.cwd()}/dist/runtime/nodeSemanticLintJob.js`).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          import { createNodeSemanticLintJob } from ${JSON.stringify(moduleUrl)};
          const jobs = Array.from({ length: 100 }, (_, index) =>
            createNodeSemanticLintJob({
              source: "(= (fact $n) (fact (- $n 1))) ; " + index,
              severities: {}
            })
          );
          for (const job of jobs) job.cancel();
          const responses = await Promise.all(jobs.map((job) => job.response));
          if (responses.some((response) => response.error !== "cancelled")) {
            console.error(JSON.stringify(responses));
            process.exit(1);
          }
        `,
      ],
      { encoding: "utf8", timeout: 5_000 },
    );
    expect(result.error).toBeUndefined();
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || "worker exited");
    expect(result.status).toBe(0);
  });
});
