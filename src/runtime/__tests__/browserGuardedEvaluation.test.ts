// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuardedEvaluationWorkerRequest } from "../../server/guardedEvaluationTypes.js";

class FakeWorker {
  public static instances: FakeWorker[] = [];
  public static lastPayload: GuardedEvaluationWorkerRequest | undefined;
  public static respond = true;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public readonly url: string | URL;
  public terminated = false;

  public constructor(url: string | URL) {
    this.url = url;
    FakeWorker.instances.push(this);
  }

  public postMessage(payload: GuardedEvaluationWorkerRequest): void {
    FakeWorker.lastPayload = payload;
    if (!FakeWorker.respond) return;
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          ok: true,
          queries: [
            {
              query: "(+ 1 1)",
              results: ["2"],
              resultCount: 1,
              truncated: false,
            },
          ],
          stdout: "",
          stderr: "",
          truncated: false,
        },
      } as MessageEvent);
    });
  }

  public terminate(): void {
    this.terminated = true;
  }
}

describe("browser guarded evaluation host", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.lastPayload = undefined;
    FakeWorker.instances.length = 0;
    FakeWorker.respond = true;
  });

  it("runs guarded evaluation through a browser worker envelope", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("crypto", webcrypto);
    const { evaluateGuardedInBrowser } = await import("../browserGuardedEvaluation.js");

    const result = await evaluateGuardedInBrowser(
      { source: "!(+ 1 1)", wrapBareExpression: false },
      new URL("../browserEvaluationWorker.js", import.meta.url),
    );

    expect(result.ok).toBe(true);
    expect(result.guarded).toBe(true);
    expect(result.sourceHash).toHaveLength(64);
    expect(result.queries.at(-1)?.results).toStrictEqual(["2"]);
    expect(FakeWorker.lastPayload?.policy.tabling).toBe(true);
    expect(FakeWorker.lastPayload?.imports).toStrictEqual({});
  });

  it("terminates browser evaluation when its request is cancelled", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("crypto", webcrypto);
    const { evaluateGuardedInBrowser } = await import("../browserGuardedEvaluation.js");
    const cancellation = new AbortController();
    FakeWorker.respond = false;

    const evaluating = evaluateGuardedInBrowser(
      { source: "!(+ 1 1)", wrapBareExpression: false },
      new URL("../browserEvaluationWorker.js", import.meta.url),
      cancellation.signal,
    );
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    cancellation.abort();
    const result = await evaluating;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Evaluation cancelled.");
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
});
