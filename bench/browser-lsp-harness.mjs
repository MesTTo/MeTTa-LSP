// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { Worker } from "node:worker_threads";

export const DEFAULT_BROWSER_LSP_ROOT = "vscode-vfs://bench/ws";

export function browserWorker(script) {
  return new Worker(new URL("./browser-worker-node-adapter.mjs", import.meta.url), {
    workerData: { script: new URL(script, import.meta.url).href },
    execArgv: [],
  });
}

export function createBrowserLspHarness(
  workspaceFiles = new Map(),
  {
    rootUri = DEFAULT_BROWSER_LSP_ROOT,
    script = new URL("../dist/server/browserServer.js", import.meta.url),
    timeoutMs = 10_000,
  } = {},
) {
  const worker = browserWorker(script);
  let nextId = 1;
  const pending = new Map();
  const diagnosticsWaiters = [];
  const send = (message) => worker.postMessage({ jsonrpc: "2.0", ...message });
  const respond = (id, result) => send({ id, result });
  const notify = (method, params) => send({ method, params });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      send({ id, method, params });
    });
  const waitDiagnostics = (uri, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const waiter = {
        uri,
        predicate,
        resolve: (diagnostics) => {
          clearTimeout(timeout);
          resolve(diagnostics);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      const timeout = setTimeout(() => {
        const index = diagnosticsWaiters.indexOf(waiter);
        if (index >= 0) diagnosticsWaiters.splice(index, 1);
        reject(new Error(`diagnostics for ${uri} timed out`));
      }, timeoutMs);
      diagnosticsWaiters.push(waiter);
    });

  worker.on("message", (message) => {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(String(message.error.message ?? message.error)));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "metta/fs/watchPattern") {
      respond(message.id, { watching: true });
      return;
    }
    if (message.method === "metta/fs/listFiles") {
      const requested = Number(message.params?.maxFiles ?? workspaceFiles.size);
      const maxFiles = Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0;
      const extensions = new Set(
        Array.isArray(message.params?.extensions) ? message.params.extensions : [],
      );
      const candidates = [...workspaceFiles.entries()].filter(([uri]) =>
        extensions.size === 0 ? true : [...extensions].some((extension) => uri.endsWith(extension)),
      );
      const files = candidates.slice(0, maxFiles).map(([uri, text]) => ({ uri, text }));
      respond(message.id, { files, truncated: candidates.length > maxFiles });
      return;
    }
    if (message.method === "metta/fs/readFile") {
      const uri = String(message.params?.uri ?? "");
      respond(message.id, { uri, text: workspaceFiles.get(uri) ?? null });
      return;
    }
    if (message.method === "workspace/configuration") {
      const count = Array.isArray(message.params?.items) ? message.params.items.length : 0;
      respond(
        message.id,
        Array.from({ length: count }, () => ({})),
      );
      return;
    }
    if (message.method === "workspace/workspaceFolders") {
      respond(message.id, [{ uri: rootUri, name: "browser workspace" }]);
      return;
    }
    if (message.id !== undefined) {
      respond(message.id, null);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      const diagnostics = message.params?.diagnostics ?? [];
      for (let index = diagnosticsWaiters.length - 1; index >= 0; index -= 1) {
        const waiter = diagnosticsWaiters[index];
        if (waiter?.uri === uri && waiter.predicate(diagnostics)) {
          diagnosticsWaiters.splice(index, 1);
          waiter.resolve(diagnostics);
        }
      }
    }
  });
  worker.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const waiter of diagnosticsWaiters.splice(0)) waiter.reject(error);
  });

  return {
    async initialize({ capabilities = {}, initializationOptions } = {}) {
      const result = await request("initialize", {
        processId: null,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: "browser workspace" }],
        capabilities,
        clientInfo: { name: "browser-lsp-harness" },
        initializationOptions,
      });
      notify("initialized", {});
      return result;
    },
    async open(uri, text, version = 1) {
      workspaceFiles.set(uri, text);
      const diagnostics = waitDiagnostics(uri);
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "metta", version, text },
      });
      return diagnostics;
    },
    async change(uri, text, version) {
      workspaceFiles.set(uri, text);
      const diagnostics = waitDiagnostics(uri);
      notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      return diagnostics;
    },
    request,
    notify,
    waitDiagnostics,
    dispose() {
      void worker.terminate();
    },
  };
}
