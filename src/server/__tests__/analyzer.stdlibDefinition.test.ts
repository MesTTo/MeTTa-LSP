// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Go to Definition on a builtin lands on its declaration in a generated, read-only stdlib reference document
// (metta://stdlib/….metta), served to the client content provider — the way rust-analyzer navigates into the
// standard library.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

describe("go to definition into the stdlib reference", () => {
  it("points a builtin type to its declaration line in the generated types document", () => {
    const analyzer = analyzerWith("(: x Number)");
    const [loc] = analyzer.definition(URI, { line: 0, character: 5 });
    expect(loc?.uri).toBe("metta://stdlib/types.metta");
    const doc = analyzer.stdlibDocument("metta://stdlib/types.metta") ?? "";
    expect(doc.split("\n")[loc?.range.start.line ?? -1]).toBe("(: Number Type)");
  });

  it("points a builtin function to its declaration line in the generated builtins document", () => {
    const analyzer = analyzerWith("!(+ 1 2)");
    const [loc] = analyzer.definition(URI, { line: 0, character: 2 });
    expect(loc?.uri).toBe("metta://stdlib/builtins.metta");
    const doc = analyzer.stdlibDocument("metta://stdlib/builtins.metta") ?? "";
    expect(doc.split("\n")[loc?.range.start.line ?? -1]?.startsWith("(: +")).toBe(true);
  });

  it("returns null for an unknown stdlib document", () => {
    expect(analyzerWith("").stdlibDocument("metta://stdlib/nope.metta")).toBeNull();
  });
});
