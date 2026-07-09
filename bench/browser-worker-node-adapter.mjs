#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Run a browser Web Worker bundle inside node:worker_threads for repeatable benchmarks. The target script sees
// the browser globals it expects: postMessage, onmessage, self, and nested Worker.

import { Worker as NodeWorker, parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("browser-worker-node-adapter must run inside a worker thread");
if (typeof workerData?.script !== "string") throw new Error("workerData.script is required");

const adapterUrl = new URL("./browser-worker-node-adapter.mjs", import.meta.url);
const pendingMessages = [];

globalThis.self = globalThis;
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.addEventListener = (type, listener) => {
  if (type === "error") {
    process.on("uncaughtException", (error) => listener({ message: error.message, error }));
  }
};

class BrowserWorkerAdapter {
  onmessage = null;
  onerror = null;
  #worker;

  constructor(url) {
    const script = url instanceof URL ? url.href : new URL(String(url), workerData.script).href;
    this.#worker = new NodeWorker(adapterUrl, {
      workerData: { script },
      execArgv: [],
    });
    this.#worker.on("message", (data) => {
      this.onmessage?.({ data });
    });
    this.#worker.on("error", (error) => {
      this.onerror?.({ message: error.message, error });
    });
    this.#worker.on("exit", (code) => {
      if (code !== 0) this.onerror?.({ message: `Worker exited with code ${code}.` });
    });
  }

  postMessage(message) {
    this.#worker.postMessage(message);
  }

  terminate() {
    void this.#worker.terminate();
  }
}

globalThis.Worker = BrowserWorkerAdapter;

function deliver(data) {
  const handler = globalThis.onmessage;
  if (typeof handler === "function") handler({ data });
  else pendingMessages.push(data);
}

parentPort.on("message", deliver);

await import(workerData.script);

while (pendingMessages.length > 0) {
  const data = pendingMessages.shift();
  globalThis.onmessage?.({ data });
}
