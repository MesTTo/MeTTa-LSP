// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// workspace/willRenameFiles: when a .metta file is renamed, the server returns edits that rewrite the
// import!/include references to it, so they stay valid.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

function workspace(files: Record<string, string>): {
  analyzer: Analyzer;
  uri: (name: string) => string;
} {
  const provider = new InMemoryFileProvider("/ws");
  for (const [name, content] of Object.entries(files)) provider.writeFile(`/ws/${name}`, content);
  const analyzer = new Analyzer(provider);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  const uri = (name: string): string => `file:///ws/${name}`;
  for (const [name, content] of Object.entries(files))
    analyzer.updateDocument(uri(name), content, 1, true);
  // Resolve main's imports.
  analyzer.validate(uri("main.metta"));
  return { analyzer, uri };
}

describe("renameFileImportEdits", () => {
  it("rewrites a bare module import when its file is renamed", () => {
    const { analyzer, uri } = workspace({
      "helper.metta": "(= (help $x) $x)",
      "main.metta": "!(import! &self helper)\n!(help 1)",
    });
    const edit = analyzer.renameFileImportEdits([
      { oldUri: uri("helper.metta"), newUri: uri("utils.metta") },
    ]);
    const edits = edit?.changes?.[uri("main.metta")] ?? [];
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newText).toBe("utils");
  });

  it("returns null when nothing imports the renamed file", () => {
    const { analyzer, uri } = workspace({
      "helper.metta": "(= (help $x) $x)",
      "main.metta": "!(help 1)",
    });
    expect(
      analyzer.renameFileImportEdits([{ oldUri: uri("helper.metta"), newUri: uri("utils.metta") }]),
    ).toBeNull();
  });

  it("leaves the name unchanged when the module stem is unchanged", () => {
    const { analyzer, uri } = workspace({
      "helper.metta": "(= (help $x) $x)",
      "main.metta": "!(import! &self helper)",
    });
    expect(
      analyzer.renameFileImportEdits([
        { oldUri: uri("helper.metta"), newUri: uri("helper.metta") },
      ]),
    ).toBeNull();
  });
});
