// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BROWSER_WORKSPACE_ROOT,
  BROWSER_WORKSPACE_STORAGE_KEY,
  BrowserFileStore,
  browserFileName,
  browserFileUri,
  loadBrowserWorkspace,
  MAX_BROWSER_FILE_CHARS,
  MAX_BROWSER_FILES,
  normalizeBrowserFileName,
  type StorageLike,
  saveBrowserWorkspace,
} from "../docs-site/.vitepress/theme/browser-ide/files";
import { BrowserWorkerTransport } from "../docs-site/.vitepress/theme/browser-ide/transport";

class MemoryStorage implements StorageLike {
  public readonly values = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class FakeWorker {
  public readonly sent: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  public addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    if (type === "message") this.listeners.add(listener);
  }

  public removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    if (type === "message") this.listeners.delete(listener);
  }

  public postMessage(message: unknown): void {
    this.sent.push(message);
  }

  public emit(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }
}

describe("browser IDE file store", () => {
  it("round-trips valid nested file names through workspace URIs", () => {
    const segment = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9_-]{0,10}$/u);
    const fileName = fc
      .tuple(fc.array(segment, { minLength: 0, maxLength: 3 }), segment)
      .map(([folders, file]) => [...folders, `${file}.metta`].join("/"));

    fc.assert(
      fc.property(fileName, (name) => {
        expect(browserFileName(browserFileUri(name))).toBe(name);
      }),
    );
  });

  it("normalizes extensions and rejects traversal or non-MeTTa files", () => {
    expect(normalizeBrowserFileName("lib/math")).toBe("lib/math.metta");
    for (const name of ["../main.metta", "/main.metta", "lib//main.metta", "main.ts"]) {
      expect(() => normalizeBrowserFileName(name)).toThrow();
    }
  });

  it("preserves order across create, update, rename, and delete", () => {
    const store = new BrowserFileStore([{ name: "main.metta", text: "!main" }]);
    expect(store.create("lib/math", "!math")).toBe("lib/math.metta");
    store.update("main.metta", "!updated");
    expect(store.rename("lib/math.metta", "lib/numbers.metta")).toBe("lib/numbers.metta");
    expect(store.names()).toStrictEqual(["main.metta", "lib/numbers.metta"]);
    expect(store.get("main.metta")).toBe("!updated");
    store.delete("lib/numbers.metta");
    expect(store.names()).toStrictEqual(["main.metta"]);
  });

  it("enforces case-insensitive uniqueness and workspace bounds", () => {
    const initial = Array.from({ length: MAX_BROWSER_FILES }, (_, index) => ({
      name: `f${index}.metta`,
      text: "",
    }));
    const full = new BrowserFileStore(initial);
    expect(() => full.create("extra.metta")).toThrow(/limited/u);

    const store = new BrowserFileStore([{ name: "Main.metta", text: "" }]);
    expect(() => store.create("main.metta")).toThrow(/exists/u);
    expect(() => store.update("Main.metta", "x".repeat(MAX_BROWSER_FILE_CHARS + 1))).toThrow(
      /cannot exceed/u,
    );
  });

  it("loads only valid snapshots and tolerates unavailable storage", () => {
    const store = new BrowserFileStore([{ name: "main.metta", text: "!(+ 1 1)" }]);
    const storage = new MemoryStorage();
    saveBrowserWorkspace(storage, store, "main.metta");
    expect(loadBrowserWorkspace(storage)).toStrictEqual({
      version: 1,
      activeName: "main.metta",
      files: [{ name: "main.metta", text: "!(+ 1 1)" }],
    });

    storage.values.set(BROWSER_WORKSPACE_STORAGE_KEY, "{not-json");
    expect(loadBrowserWorkspace(storage)).toBeNull();
    expect(
      loadBrowserWorkspace({
        getItem: () => {
          throw new Error("storage denied");
        },
        setItem: () => undefined,
      }),
    ).toBeNull();
  });
});

describe("browser IDE worker transport", () => {
  it("adapts JSON messages and answers virtual file-system requests", () => {
    const files = new BrowserFileStore([
      { name: "main.metta", text: "!main" },
      { name: "notes.metta", text: "!notes" },
    ]);
    const worker = new FakeWorker();
    const transport = new BrowserWorkerTransport(worker, files);
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    expect(worker.sent[0]).toStrictEqual({ jsonrpc: "2.0", id: 1, method: "initialize" });

    worker.emit({
      jsonrpc: "2.0",
      id: 2,
      method: "metta/fs/listFiles",
      params: { roots: [`${BROWSER_WORKSPACE_ROOT}/`], extensions: [".metta"], maxFiles: 1 },
    });
    expect(worker.sent[1]).toStrictEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {
        files: [{ uri: browserFileUri("main.metta"), text: "!main" }],
        truncated: true,
      },
    });

    worker.emit({
      jsonrpc: "2.0",
      id: 3,
      method: "metta/fs/readFile",
      params: { uri: browserFileUri("notes.metta") },
    });
    expect(worker.sent[2]).toStrictEqual({
      jsonrpc: "2.0",
      id: 3,
      result: { uri: browserFileUri("notes.metta"), text: "!notes" },
    });

    worker.emit({ jsonrpc: "2.0", method: "window/logMessage", params: { message: "ready" } });
    expect(received).toStrictEqual([
      JSON.stringify({
        jsonrpc: "2.0",
        method: "window/logMessage",
        params: { message: "ready" },
      }),
    ]);

    transport.dispose();
    worker.emit({ jsonrpc: "2.0", method: "window/logMessage", params: {} });
    expect(received).toHaveLength(1);
    expect(() => transport.send("{}")).toThrow(/disconnected/u);
  });

  it("returns empty results for roots outside the browser workspace", () => {
    const worker = new FakeWorker();
    const transport = new BrowserWorkerTransport(
      worker,
      new BrowserFileStore([{ name: "main.metta", text: "" }]),
    );
    worker.emit({
      jsonrpc: "2.0",
      id: "outside",
      method: "metta/fs/listFiles",
      params: { roots: ["file:///another-workspace"], extensions: [".metta"] },
    });
    expect(worker.sent).toStrictEqual([
      {
        jsonrpc: "2.0",
        id: "outside",
        result: { files: [], truncated: false },
      },
    ]);
    transport.dispose();
  });
});
