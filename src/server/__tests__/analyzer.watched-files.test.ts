// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// `refreshFromDisk` re-indexes a file after an external change (a watched-file event): it indexes an unopened
// file, re-reads it when the disk content changes, forgets it on deletion, and leaves an open document alone
// because the editor's own sync is authoritative for it.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/lib.metta";
const PATH = "/ws/lib.metta";

function setup(source: string): { analyzer: Analyzer; files: InMemoryFileProvider } {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile(PATH, source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  return { analyzer, files };
}

const symbolNames = (analyzer: Analyzer): string[] =>
  analyzer.documentSymbols(URI).map((symbol) => symbol.name);

describe("Analyzer.refreshFromDisk", () => {
  it("indexes an unopened file from disk", () => {
    const { analyzer } = setup("(= (f) 1)");
    expect(analyzer.indexedUris()).not.toContain(URI);
    analyzer.refreshFromDisk(URI);
    expect(analyzer.indexedUris()).toContain(URI);
    expect(symbolNames(analyzer)).toContain("f");
  });

  it("re-reads the file when the disk content changes", () => {
    const { analyzer, files } = setup("(= (f) 1)");
    analyzer.refreshFromDisk(URI);
    files.writeFile(PATH, "(= (g) 2)");
    analyzer.refreshFromDisk(URI);
    expect(symbolNames(analyzer)).toContain("g");
    expect(symbolNames(analyzer)).not.toContain("f");
  });

  it("forgets the file when it is deleted", () => {
    const { analyzer, files } = setup("(= (f) 1)");
    analyzer.refreshFromDisk(URI);
    files.deleteFile(PATH);
    analyzer.refreshFromDisk(URI);
    expect(analyzer.indexedUris()).not.toContain(URI);
  });

  it("leaves an open document alone, since the editor is authoritative", () => {
    const { analyzer, files } = setup("(= (fromDisk) 1)");
    analyzer.updateDocument(URI, "(= (fromEditor) 1)", 1, true);
    files.writeFile(PATH, "(= (fromDiskChanged) 1)");
    analyzer.refreshFromDisk(URI);
    expect(symbolNames(analyzer)).toContain("fromEditor");
    expect(symbolNames(analyzer)).not.toContain("fromDiskChanged");
  });
});
