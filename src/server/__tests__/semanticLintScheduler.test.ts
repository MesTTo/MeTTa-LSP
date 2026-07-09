// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { Diagnostic } from "vscode-languageserver-types";
import type { SemanticLintJob } from "../../runtime/semanticLintJob.js";
import type {
  SemanticLintWorkerRequest,
  SemanticLintWorkerResponse,
} from "../../runtime/semanticLintShared.js";
import { Analyzer, DEFAULT_SETTINGS } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { SemanticLintScheduler } from "../semanticLintScheduler.js";

interface DeferredJob {
  readonly request: SemanticLintWorkerRequest;
  readonly job: SemanticLintJob;
  readonly settle: (response: SemanticLintWorkerResponse) => void;
}

function deferredJob(request: SemanticLintWorkerRequest): DeferredJob {
  let settle: (response: SemanticLintWorkerResponse) => void = () => undefined;
  const response = new Promise<SemanticLintWorkerResponse>((resolve) => {
    settle = resolve;
  });
  return {
    request,
    job: {
      response,
      cancel: () => settle({ ok: false, error: "cancelled" }),
    },
    settle,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition did not become true");
}

describe("SemanticLintScheduler", () => {
  it("bounds worker concurrency while still draining every scheduled file", async () => {
    const files = new InMemoryFileProvider("/ws");
    for (let i = 0; i < 5; i++) files.writeFile(`/ws/file-${i}.metta`, `(= (f${i}) ${i})`);
    const analyzer = new Analyzer(files);
    analyzer.setSemanticLintMode("cached");
    analyzer.updateSettings({
      diagnostics: { ...analyzer.getSettings().diagnostics, semanticLint: true },
    });
    analyzer.setWorkspaceRoots(["file:///ws"]);
    await analyzer.scanWorkspace();

    const jobs: DeferredJob[] = [];
    const published: Diagnostic[][] = [];
    const scheduler = new SemanticLintScheduler(analyzer, {
      debounceMs: 0,
      maxConcurrentJobs: 2,
      getSettings: () => ({ ...DEFAULT_SETTINGS.diagnostics, semanticLint: true }),
      pullDiagnostics: () => false,
      publishDiagnostics: (_uri, diagnostics) => published.push([...diagnostics]),
      refreshDiagnostics: () => undefined,
      createJob: (request) => {
        const deferred = deferredJob(request);
        jobs.push(deferred);
        return deferred.job;
      },
    });

    scheduler.scheduleAll(analyzer.indexedUris());
    await waitFor(() => jobs.length === 2);
    expect(jobs).toHaveLength(2);

    for (let expected = 3; expected <= 5; expected++) {
      jobs[expected - 3]?.settle({ ok: true, violations: [] });
      await waitFor(() => jobs.length === expected);
      expect(jobs).toHaveLength(expected);
    }

    jobs.at(-2)?.settle({ ok: true, violations: [] });
    jobs.at(-1)?.settle({ ok: true, violations: [] });
    await waitFor(() => published.length === 5);

    expect(jobs.map((job) => job.request.source).sort()).toStrictEqual([
      "(= (f0) 0)",
      "(= (f1) 1)",
      "(= (f2) 2)",
      "(= (f3) 3)",
      "(= (f4) 4)",
    ]);
  });
});
