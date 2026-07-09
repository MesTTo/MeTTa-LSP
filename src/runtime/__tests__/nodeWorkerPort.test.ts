// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const port = vi.hoisted(() => ({
  handlers: [] as Array<(message: unknown) => void>,
  postMessage: vi.fn(),
  close: vi.fn(),
}));

vi.mock("node:worker_threads", () => ({
  parentPort: {
    on: (_event: string, handler: (message: unknown) => void) => {
      port.handlers.push(handler);
    },
    postMessage: port.postMessage,
    close: port.close,
  },
}));

import {
  CANCEL_WORKER_MESSAGE,
  serveNodeWorker,
  WORKER_CANCELLED_MESSAGE,
} from "../nodeWorkerPort.js";

function latestHandler(): (message: unknown) => void {
  const handler = port.handlers.at(-1);
  if (handler === undefined) throw new Error("worker message handler was not registered");
  return handler;
}

beforeEach(() => {
  port.handlers.length = 0;
  port.postMessage.mockReset();
  port.close.mockReset();
});

describe("serveNodeWorker cancellation", () => {
  it("acknowledges cancellation only after cleanup finishes", async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    serveNodeWorker(async () => ({ ok: true }), { cancel: () => cleanup });

    latestHandler()(CANCEL_WORKER_MESSAGE);
    await Promise.resolve();
    expect(port.postMessage).not.toHaveBeenCalled();

    finishCleanup?.();
    await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith(WORKER_CANCELLED_MESSAGE));
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("suppresses a run response that settles after cancellation", async () => {
    let finishRun: ((response: { ok: true }) => void) | undefined;
    const run = new Promise<{ ok: true }>((resolve) => {
      finishRun = resolve;
    });
    serveNodeWorker(async () => run);
    const handle = latestHandler();

    handle({ source: "" });
    handle(CANCEL_WORKER_MESSAGE);
    finishRun?.({ ok: true });

    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(port.postMessage).toHaveBeenCalledWith(WORKER_CANCELLED_MESSAGE);
  });

  it("acknowledges cancellation when cleanup throws synchronously", async () => {
    serveNodeWorker(async () => ({ ok: true }), {
      cancel: () => {
        throw new Error("cleanup failed");
      },
    });

    latestHandler()(CANCEL_WORKER_MESSAGE);

    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    expect(port.postMessage).toHaveBeenCalledWith(WORKER_CANCELLED_MESSAGE);
  });

  it("ignores duplicate cancellation messages", async () => {
    const cancel = vi.fn();
    serveNodeWorker(async () => ({ ok: true }), { cancel });
    const handle = latestHandler();

    handle(CANCEL_WORKER_MESSAGE);
    handle(CANCEL_WORKER_MESSAGE);

    await vi.waitFor(() => expect(port.close).toHaveBeenCalledOnce());
    expect(cancel).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });
});
