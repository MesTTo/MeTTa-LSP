// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// End-to-end: formatDocument discovers the workspace lint.metta and formats through it, so a project's width
// and per-form rules actually reach the printer.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function analyzerWith(source: string, configText?: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  if (configText !== undefined) files.writeFile("/ws/lint.metta", configText);
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

describe("formatDocument honors lint.metta", () => {
  const shortDef = "(= (f $x) (g $x $x $x))";

  it("leaves a short def on one line under the default width", () => {
    // the only change is the formatter's ensured final newline; the def stays inline
    const out = analyzerWith(shortDef).formatDocument(MAIN)[0]?.newText ?? shortDef;
    expect(out.trimEnd()).toBe(shortDef);
  });

  it("uses the project width to break a def the default width would keep inline", () => {
    const edits = analyzerWith(shortDef, "(format-width 12)").formatDocument(MAIN);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.newText).toContain("(= (f $x)\n");
  });

  it("applies a project-declared align form", () => {
    const wide = "(my-rel aaaaaaaa bbbbbbbb cccccccc)";
    const config = "(format-width 16)\n(format-align-form my-rel)";
    const out = (analyzerWith(wide, config).formatDocument(MAIN)[0]?.newText ?? wide).trimEnd();
    // align stacks arguments under the first, at the width of "(my-rel " = column 8
    expect(out).toBe("(my-rel aaaaaaaa\n        bbbbbbbb\n        cccccccc)");
  });

  it("applies a project-declared block form's head-line argument count", () => {
    const wide = "(with-scope $env aaaaaaaa bbbbbbbb cccccccc)";
    const config = "(format-width 20)\n(format-block-form with-scope 1)";
    const out = (analyzerWith(wide, config).formatDocument(MAIN)[0]?.newText ?? wide).trimEnd();
    expect(out).toBe("(with-scope $env\n  aaaaaaaa\n  bbbbbbbb\n  cccccccc)");
  });
});
