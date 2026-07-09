// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The FileProvider abstraction: the in-memory implementation's behaviour, and proof that the analyzer
// indexes a workspace and resolves cross-file definitions through an injected FileProvider with no node
// fs in the loop (the same path the browser host takes).

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { BrowserFileProvider } from "../browserFileProvider.js";
import { InMemoryFileProvider } from "../fileProvider.js";

describe("InMemoryFileProvider", () => {
  it("reads back written files with utf-8 sizes", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/a.metta", "(= (f) 1)");
    expect(files.readFile("/ws/a.metta")).toBe("(= (f) 1)");
    expect(files.stat("/ws/a.metta")?.isFile).toBe(true);
    expect(files.stat("/ws/a.metta")?.size).toBe(9);
    expect(files.readFile("/ws/missing.metta")).toBeNull();
    expect(files.cwd()).toBe("/ws");
  });

  it("derives directories from the file paths present and lists their entries", () => {
    const files = new InMemoryFileProvider();
    files.writeFile("/ws/a.metta", "a");
    files.writeFile("/ws/sub/b.metta", "b");
    expect(files.stat("/ws")?.isDirectory).toBe(true);
    expect([...(files.readDir("/ws") ?? [])].sort()).toStrictEqual(["a.metta", "sub"]);
    expect(files.readDir("/ws/nope")).toBeNull();
  });

  it("reflects deletes and re-writes", () => {
    const files = new InMemoryFileProvider();
    files.writeFile("/ws/a.metta", "one");
    files.deleteFile("/ws/a.metta");
    expect(files.readFile("/ws/a.metta")).toBeNull();
    expect(files.stat("/ws/a.metta")).toBeNull();
  });
});

describe("Analyzer over an in-memory file system (no node fs)", () => {
  it("scans a workspace and resolves cross-file definitions", async () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lib.metta", "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))");
    files.writeFile("/ws/main.metta", '(import! &self "lib")\n!(inc 1)');
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    await analyzer.scanWorkspace();

    expect(analyzer.workspaceSymbols("inc").some((symbol) => symbol.name === "inc")).toBe(true);
    // The import in main.metta resolves to lib.metta: definitions are visible across files. The position
    // is inside the `inc` call on line 1 (`!(inc 1)`).
    const definitions = analyzer.definition("file:///ws/main.metta", { line: 1, character: 3 });
    expect(definitions.some((location) => location.uri.endsWith("lib.metta"))).toBe(true);
  });
});

describe("BrowserFileProvider", () => {
  it("maps virtual workspace URIs to stable paths and back for import resolution", async () => {
    const files = new BrowserFileProvider();
    const lib = "vscode-vfs://github/alice/demo/lib.metta";
    const main = "vscode-vfs://github/alice/demo/main.metta";
    files.cacheFile(lib, "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))");
    files.cacheFile(main, "!(import! &self lib)\n!(inc 1)");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["vscode-vfs://github/alice/demo"]);
    await analyzer.scanWorkspace();

    expect(analyzer.importSourceMap(main).lib).toContain("(inc $x)");
    const definitions = analyzer.definition(main, { line: 1, character: 3 });
    expect(definitions.some((location) => location.uri === lib)).toBe(true);
  });
});
