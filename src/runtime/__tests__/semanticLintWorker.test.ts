// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSemanticLintJob } from "../semanticLintWorker.js";

let workerModuleUrl = "";
let workerBuildDir = "";

beforeAll(async () => {
  const tempRoot = join(process.cwd(), "ai-tmp");
  mkdirSync(tempRoot, { recursive: true });
  workerBuildDir = mkdtempSync(join(tempRoot, "semantic-lint-worker-"));
  const runtimeDir = join(workerBuildDir, "runtime");
  await Promise.all([
    build({
      entryPoints: ["src/runtime/nodeSemanticLintJob.ts"],
      outfile: join(runtimeDir, "nodeSemanticLintJob.js"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
    }),
    build({
      entryPoints: ["src/runtime/semanticLintWorker.ts"],
      outfile: join(runtimeDir, "semanticLintWorker.js"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
    }),
  ]);
  workerModuleUrl = pathToFileURL(join(runtimeDir, "nodeSemanticLintJob.js")).href;
});

afterAll(() => {
  if (workerBuildDir !== "") rmSync(workerBuildDir, { recursive: true, force: true });
});

function runWorkerProcess(body: string): number {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { createNodeSemanticLintJob } from ${JSON.stringify(workerModuleUrl)};\n${body}`,
    ],
    { encoding: "utf8", timeout: 5_000 },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "worker exited");
  return result.status;
}

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
    expect(
      runWorkerProcess(`
          const job = createNodeSemanticLintJob({
            source: "(= (fact $n) (fact (- $n 1)))",
            severities: {}
          });
          const response = await job.response;
          if (!response.ok) {
            console.error(response.error ?? "semantic lint failed");
            process.exit(1);
          }
        `),
    ).toBe(0);
  });

  it("settles cancelled Node worker jobs so stale scheduler closures are released", () => {
    expect(
      runWorkerProcess(`
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
        `),
    ).toBe(0);
  });
});
