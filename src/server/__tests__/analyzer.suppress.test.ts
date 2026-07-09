// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Inline suppression as an LSP surface: a `; @suppress <code>` comment silences that diagnostic on its line
// and the next, `; @suppress-file` silences a code (or everything) for the whole file, and every diagnostic
// offers a "Suppress <code> on this line" quick-fix. Also covers the reachable variable.suspiciousSemicolon.
// The vehicle is a near-miss of a builtin (a possible-typo hint) or an arity error, since an unknown head is
// valid data in MeTTa and no longer a diagnostic on its own.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function workspace(source: string, config?: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  if (config !== undefined) files.writeFile("/ws/lint.metta", config);
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

const codes = (analyzer: Analyzer) => analyzer.validate(MAIN).map((d) => d.code);

const hoverValue = (analyzer: Analyzer, line: number, character: number): string => {
  const hover = analyzer.hover(MAIN, { line, character });
  const contents = hover?.contents as { value?: string } | undefined;
  return contents?.value ?? "";
};

const messageText = (d: { message: string | { value: string } }): string =>
  typeof d.message === "string" ? d.message : d.message.value;

describe("inline diagnostic suppression", () => {
  it("silences a core diagnostic on the comment's line and the next", () => {
    const analyzer = workspace(
      [
        "(= (a $x) (car-atomm $x))",
        "; @suppress symbol.possibleTypo",
        "(= (b $x) (cdr-atomm $x))",
      ].join("\n"),
    );
    const hits = analyzer.validate(MAIN).filter((d) => d.code === "symbol.possibleTypo");
    // Only the first, un-suppressed near-miss on line 0 survives; line 2 is covered by the line-1 directive.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.range.start.line).toBe(0);
  });

  it("suppresses a trailing directive on the form's own line", () => {
    const analyzer = workspace("(= (a $x) (car-atomm $x)) ; @suppress symbol.possibleTypo");
    expect(codes(analyzer)).not.toContain("symbol.possibleTypo");
  });

  it("only suppresses the named code, leaving others", () => {
    const analyzer = workspace(["; @suppress symbol.possibleTypo", "!(car-atom)"].join("\n"));
    // The named code is irrelevant here; the arity error on the covered line must still fire.
    expect(codes(analyzer)).toContain("call.arity");
  });

  it("silences a code for the whole file with @suppress-file <code>", () => {
    const analyzer = workspace(
      ["; @suppress-file symbol.possibleTypo", "(= (a) (car-atomm))", "(= (b) (cdr-atomm))"].join(
        "\n",
      ),
    );
    expect(codes(analyzer)).not.toContain("symbol.possibleTypo");
  });

  it("silences everything with a bare @suppress-file", () => {
    const analyzer = workspace(
      ["; @suppress-file", "(= (a) (car-atomm))", "(: x NoSuchType)"].join("\n"),
    );
    expect(analyzer.validate(MAIN)).toHaveLength(0);
  });

  it("offers a Suppress quick-fix that inserts the directive above the line", () => {
    const analyzer = workspace("(= (a $x) (car-atomm $x))");
    const actions = analyzer.codeActions(MAIN, {
      start: { line: 0, character: 10 },
      end: { line: 0, character: 20 },
    });
    const fix = actions.find((a) => a.title === "Suppress symbol.possibleTypo on this line");
    expect(fix).toBeDefined();
    const edit = fix?.edit?.changes?.[MAIN]?.[0];
    expect(edit?.newText).toBe("; @suppress symbol.possibleTypo\n");
    expect(edit?.range.start).toEqual({ line: 0, character: 0 });
  });
});

describe("variable.suspiciousSemicolon", () => {
  it("fires when a ';' immediately follows a variable (starting a comment)", () => {
    // The closing paren is on the next line, so the form still parses; the ';' comments out the rest of
    // line 1, which is exactly the hazard.
    const analyzer = workspace(["(= (e)", "   $w;commented tail", ")"].join("\n"));
    const hit = analyzer.validate(MAIN).find((d) => d.code === "variable.suspiciousSemicolon");
    expect(hit).toBeDefined();
    expect(hit?.range.start.line).toBe(1);
  });

  it("does not fire when whitespace separates the variable from a comment", () => {
    const analyzer = workspace(["(= (e)", "   $w ; a normal comment", ")"].join("\n"));
    expect(codes(analyzer)).not.toContain("variable.suspiciousSemicolon");
  });
});

describe("code-as-data pattern suppression", () => {
  it("suppresses a code inside forms matching a lint.metta pattern", () => {
    const analyzer = workspace(
      "(= (a) (legacy-call (car-atomm 1)))\n(= (b) (cdr-atomm 2))",
      "(suppress (legacy-call $$$) symbol.possibleTypo)",
    );
    const hits = analyzer.validate(MAIN).filter((d) => d.code === "symbol.possibleTypo");
    // Only the near-miss outside the matched (legacy-call …) form survives.
    expect(hits).toHaveLength(1);
    expect(hits[0]?.range.start.line).toBe(1);
  });

  it("suppresses every code inside matching forms when the pattern lists none", () => {
    const analyzer = workspace(
      "(: known (-> Number Number))\n(= (known $x) $x)\n(= (a) (legacy-call (known 1 2 3)))",
      "(suppress (legacy-call $$$))",
    );
    // The arity error on the nested known call is inside the match; nothing else fires.
    expect(analyzer.validate(MAIN)).toHaveLength(0);
  });

  it("does not suppress the same code outside the matched form", () => {
    const analyzer = workspace(
      "(= (a) (legacy-call (car-atomm 1)))\n(= (b) (cdr-atomm 2))",
      "(suppress (legacy-call $$$) symbol.possibleTypo)",
    );
    expect(analyzer.validate(MAIN).some((d) => messageText(d).includes("cdr-atomm"))).toBe(true);
  });
});

describe("suppression transparency", () => {
  it("reports each suppressed diagnostic with a reason naming the directive or rule", () => {
    const analyzer = workspace(
      "(= (a) (legacy-call (car-atomm 1)))\n; @suppress symbol.possibleTypo\n(= (b) (cdr-atomm 2))\n(= (c) (car-atom (1 2)))",
      "(suppress (legacy-call $$$) symbol.possibleTypo)",
    );
    const suppressed = analyzer.suppressedDiagnostics(MAIN);
    // The pattern hides the near-miss inside legacy-call (line 0) and the inline directive hides the line-2
    // near-miss; the correct car-atom call on line 3 has no diagnostic.
    expect(suppressed.map((s) => s.diagnostic.range.start.line)).toEqual([0, 2]);
    expect(suppressed.some((s) => s.reason.includes("(suppress (legacy-call"))).toBe(true);
    expect(suppressed.some((s) => s.reason.startsWith("; @suppress"))).toBe(true);
  });

  it("itemizes a suppressed lint rule, which the linter drops before assembly", () => {
    const analyzer = workspace("(= (f $x) (if True $x 0)) ; @suppress constant-if-true");
    expect(
      analyzer.suppressedDiagnostics(MAIN).some((s) => s.diagnostic.code === "constant-if-true"),
    ).toBe(true);
  });

  it("hovers a directive to show what it silences", () => {
    const analyzer = workspace("; @suppress symbol.possibleTypo\n(= (a) (car-atomm 1))");
    const value = hoverValue(analyzer, 0, 5);
    expect(value).toContain("silences");
    expect(value).toContain("symbol.possibleTypo");
  });

  it("hovers an unused directive as unused", () => {
    const analyzer = workspace("; @suppress constant-if-true\n(= (a) 5)");
    expect(hoverValue(analyzer, 0, 5)).toContain("unused");
  });
});
