// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A lint.metta is a metta-semgrep rule file: its forms are structural patterns over code-as-data, matched by
// the linter, never evaluated as a MeTTa program. So its DSL vocabulary and pattern atoms are not undefined
// symbols, and the rules do not lint the rule file's own definitions. An ordinary file is unaffected.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

function analyze(fileName: string, text: string) {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile(`/ws/${fileName}`, text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  const uri = `file:///ws/${fileName}`;
  analyzer.updateDocument(uri, text, 1, true);
  return analyzer.validate(uri);
}

const RULE =
  '(lint-rule no-debug (pattern (debug! $X)) (message "leftover debug!") (severity warn) (fix $X))';
const SUPPRESS = "(suppress (legacy $$$) symbol.possibleTypo)";

describe("lint.metta is a metta-semgrep rule file, not evaluated MeTTa", () => {
  it("does not flag the rule DSL or pattern atoms with a symbol hint", () => {
    const codes = analyze("lint.metta", `${RULE}\n${SUPPRESS}`).map((d) => d.code);
    expect(codes.filter((code) => String(code).startsWith("symbol."))).toEqual([]);
  });

  it("does not apply its own rules to its rule definitions", () => {
    // The no-debug rule must not match the (debug! $X) inside its own (pattern …) clause.
    const messages = analyze("lint.metta", RULE).map((d) => JSON.stringify(d.message));
    expect(messages.some((m) => m.includes("leftover debug!"))).toBe(false);
  });

  it("still surfaces a symbol hint in an ordinary file — only lint.metta is exempt", () => {
    // An unknown head is data (no error), but a near-miss of a builtin gets a possible-typo hint in an
    // ordinary file. A lint.metta rule file suppresses symbol hints on its DSL vocabulary.
    const codes = analyze("program.metta", "(= (uses $x) (car-atomm $x))").map((d) => d.code);
    expect(codes).toContain("symbol.possibleTypo");
    const lintCodes = analyze("lint.metta", "(= (uses $x) (car-atomm $x))").map((d) => d.code);
    expect(lintCodes).not.toContain("symbol.possibleTypo");
  });
});

describe("lint.metta schema errors are reported, not silently dropped", () => {
  it("flags a rule missing its (pattern …) or (message …)", () => {
    const codes = analyze("lint.metta", '(lint-rule bad (message "no pattern"))').map(
      (d) => d.code,
    );
    expect(codes).toContain("lint.ruleSchema");
  });

  it("does not flag a well-formed rule file", () => {
    const codes = analyze("lint.metta", `${RULE}\n${SUPPRESS}`).map((d) => d.code);
    expect(codes).not.toContain("lint.ruleSchema");
  });
});

describe("lint.metta DSL vocabulary hovers with an explanation", () => {
  it("hovers lint-rule with what it declares", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/lint.metta";
    files.writeFile("/ws/lint.metta", RULE);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, RULE, 1, true);
    const hover = analyzer.hover(uri, { line: 0, character: 2 });
    const value =
      hover && typeof hover.contents === "object" && "value" in hover.contents
        ? hover.contents.value
        : "";
    expect(value).toContain("lint-rule");
  });

  it("hovers metavariable-regex with its constraint shape", () => {
    const files = new InMemoryFileProvider("/ws");
    const src =
      '(lint-rule capital-name (pattern (: $Name $Type)) (metavariable-regex $Name "^[A-Z]") (message "m"))';
    const uri = "file:///ws/lint.metta";
    files.writeFile("/ws/lint.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const hover = analyzer.hover(uri, {
      line: 0,
      character: src.indexOf("metavariable-regex") + 2,
    });
    const value =
      hover && typeof hover.contents === "object" && "value" in hover.contents
        ? hover.contents.value
        : "";
    expect(value).toContain("metavariable-regex");
  });
});

describe("lint.metta DSL vocabulary is offered in completion", () => {
  it("offers the rule keywords in a rule file, not in a program", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(l");
    files.writeFile("/ws/prog.metta", "(l");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/lint.metta", "(l", 1, true);
    analyzer.updateDocument("file:///ws/prog.metta", "(l", 1, true);
    const at = { line: 0, character: 2 };
    const lintLabels = analyzer.completions("file:///ws/lint.metta", at).map((i) => i.label);
    expect(lintLabels).toContain("lint-rule");
    const progLabels = analyzer.completions("file:///ws/prog.metta", at).map((i) => i.label);
    expect(progLabels).not.toContain("lint-rule");
  });

  it("offers regex constraints in a rule file, not in a program", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(m");
    files.writeFile("/ws/prog.metta", "(m");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/lint.metta", "(m", 1, true);
    analyzer.updateDocument("file:///ws/prog.metta", "(m", 1, true);
    const at = { line: 0, character: 2 };
    const lintLabels = analyzer.completions("file:///ws/lint.metta", at).map((i) => i.label);
    expect(lintLabels).toContain("metavariable-regex");
    const progLabels = analyzer.completions("file:///ws/prog.metta", at).map((i) => i.label);
    expect(progLabels).not.toContain("metavariable-regex");
  });
});
