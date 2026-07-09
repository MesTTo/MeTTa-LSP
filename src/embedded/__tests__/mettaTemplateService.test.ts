// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The MettaTemplateService answers TypeScript-server requests inside a MeTTa tagged template by running the
// real Analyzer over the body. A fake TemplateContext stands in for the decorator: `text` is the body,
// `toOffset` maps through the body's line map, and `node` supplies a position and a (here absent) source
// file. No tsserver is needed to exercise the whole delegation-and-conversion path.

import * as ts from "typescript";
import type { TemplateContext } from "typescript-template-language-service-decorator";
import { describe, expect, it } from "vitest";
import { MettaTemplateService } from "../mettaTemplateService.js";
import { bodyOffsetAt } from "../tsConversion.js";

function fakeContext(text: string, fileName = "/host.ts", nodePos = 0): TemplateContext {
  return {
    typescript: ts,
    fileName,
    text,
    rawText: text,
    node: { pos: nodePos, getSourceFile: () => undefined } as unknown as TemplateContext["node"],
    toOffset: (position) => bodyOffsetAt(position, text),
    toPosition: (offset) => ({ line: 0, character: offset }),
  };
}

const SRC = ["(: foo (-> Number Number))", "(= (foo $x) (car-atomm $x))", "(foo 1)"].join("\n");

describe("MettaTemplateService", () => {
  it("surfaces a MeTTa diagnostic for a near-miss atom in the template body", () => {
    // car-atomm is an unknown head (data in MeTTa), but a near-miss of the car-atom builtin, so it gets a
    // possible-typo hint — surfaced through the template service as a message-category diagnostic.
    const diagnostics = new MettaTemplateService(ts).getSemanticDiagnostics(fakeContext(SRC));
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(
      diagnostics.some(
        (diag) => typeof diag.messageText === "string" && diag.messageText.includes("car-atomm"),
      ),
    ).toBe(true);
    // the diagnostic points at the `car-atomm` occurrence on line 1 (a body offset the decorator later
    // repositions into the host file)
    const target = SRC.indexOf("car-atomm");
    expect(diagnostics.some((diag) => diag.start === target)).toBe(true);
  });

  it("offers completions that include a workspace definition and a builtin", () => {
    const names = new MettaTemplateService(ts)
      .getCompletionsAtPosition(fakeContext(SRC), { line: 2, character: 1 })
      .entries.map((entry) => entry.name);
    expect(names).toContain("foo");
    expect(names).toContain("match");
  });

  it("returns quick info over a defined symbol", () => {
    const quick = new MettaTemplateService(ts).getQuickInfoAtPosition(fakeContext(SRC), {
      line: 0,
      character: 3,
    });
    expect(quick).toBeDefined();
  });

  it("lists outlining spans for the template's definitions", () => {
    const spans = new MettaTemplateService(ts).getOutliningSpans(fakeContext(SRC));
    expect(spans.map((span) => span.bannerText)).toContain("foo");
  });

  it("keeps two templates in the same file independent via their node position", () => {
    const service = new MettaTemplateService(ts);
    const first = service.getSemanticDiagnostics(fakeContext("(car-atomm 1)", "/a.ts", 10));
    const second = service.getSemanticDiagnostics(fakeContext("(cdr-atomm 2)", "/a.ts", 40));
    const firstMessages = first.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
    const secondMessages = second.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );

    expect(firstMessages.some((message) => message.includes("car-atomm"))).toBe(true);
    expect(firstMessages.some((message) => message.includes("cdr-atomm"))).toBe(false);
    expect(secondMessages.some((message) => message.includes("cdr-atomm"))).toBe(true);
    expect(secondMessages.some((message) => message.includes("car-atomm"))).toBe(false);
  });
});

const REFS = ["(: greet (-> String String))", "(= (greet $x) $x)", '(greet "hi")'].join("\n");

describe("MettaTemplateService navigation and fixes", () => {
  it("finds references to a symbol across the template body", () => {
    // the `greet` head of the call on line 2
    const refs = new MettaTemplateService(ts).getReferencesAtPosition(fakeContext(REFS), {
      line: 2,
      character: 1,
    });
    expect(refs).toBeDefined();
    // the signature, the clause, and the call all reference `greet`
    expect(refs?.length).toBeGreaterThanOrEqual(2);
  });

  it("returns definitions and a bound span over the clicked symbol", () => {
    const result = new MettaTemplateService(ts).getDefinitionAndBoundSpan(fakeContext(REFS), {
      line: 2,
      character: 1,
    });
    expect(result.definitions?.length).toBeGreaterThanOrEqual(1);
    // the bound span covers the five characters of `greet`
    expect(result.textSpan.length).toBe(5);
  });

  it("offers a did-you-mean code fix for a misspelled symbol", () => {
    const typo = ["(: greet (-> String String))", "(= (greet $x) $x)", '(gret "hi")'].join("\n");
    const context = fakeContext(typo);
    const start = typo.indexOf("gret");
    const fixes = new MettaTemplateService(ts).getCodeFixesAtPosition(context, start, start + 4);
    expect(fixes.some((fix) => fix.description.includes("greet"))).toBe(true);
    // the fix edits the template's own document, so its span lands inside the body
    const change = fixes[0]?.changes[0]?.textChanges[0];
    expect(change?.span.start).toBeGreaterThanOrEqual(0);
  });

  it("declares the MeTTa diagnostic code as fixable", () => {
    expect(new MettaTemplateService(ts).getSupportedCodeFixes()).toContain(1_000_000);
  });
});
