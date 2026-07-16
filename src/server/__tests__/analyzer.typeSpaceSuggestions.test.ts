// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Undefined-type and unbound-space diagnostics carry a correction, the way MeTTaTron does: a miscapitalized
// known type (number -> Number) and a mis-cased space (&Self -> &self) each name the fix and the reason, and a
// near-miss of a known type is offered for a typo. A genuinely unknown uppercase type stays a plain warning.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerFor(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function messagesFor(text: string, code: string): string[] {
  return analyzerFor(text)
    .validate(URI)
    .filter((d) => d.code === code)
    .map((d) => (typeof d.message === "string" ? d.message : ""));
}

describe("type + space suggestions", () => {
  it("flags a miscapitalized type and teaches that type names are capitalized", () => {
    expect(messagesFor("(: f (-> number Number))", "type.undefined")).toEqual([
      "Undefined type 'number' in signature for 'f'. Type names are capitalized — did you mean 'Number'?",
    ]);
  });

  it("suggests the nearest known type for a typo", () => {
    expect(messagesFor("(: g (-> Numbr Number))", "type.undefined")).toEqual([
      "Undefined type 'Numbr' in signature for 'g'. Did you mean 'Number'?",
    ]);
  });

  it("leaves a genuinely unknown uppercase type a plain warning", () => {
    expect(messagesFor("(: h (-> Widget Number))", "type.undefined")).toEqual([
      "Undefined type 'Widget' in signature for 'h'.",
    ]);
  });

  it("flags a mis-cased space and teaches that space names are case-sensitive", () => {
    expect(messagesFor("(= (q) (match &Self (foo) bar))", "space.unbound")).toEqual([
      "Unbound atom-space symbol '&Self'. Space names are case-sensitive — did you mean '&self'?",
    ]);
  });

  it("offers a quick-fix that corrects the space case", () => {
    const analyzer = analyzerFor("(= (q) (match &Self (foo) bar))");
    const diag = analyzer.validate(URI).find((d) => d.code === "space.unbound");
    if (diag === undefined) throw new Error("expected an unbound-space diagnostic");
    const fix = analyzer
      .codeActions(URI, diag.range)
      .find((a) => a.title === "Change '&Self' to '&self'");
    expect(fix?.edit?.changes?.[URI]?.[0]?.newText).toBe("&self");
  });

  it("treats the target of a running import as a space binding", () => {
    const source = ['!(import! &schema "../data/epilog-parts")', "!(match &schema ($x) $x)"].join(
      "\n",
    );

    expect(messagesFor(source, "space.unbound")).toEqual([]);
  });

  it("does not treat an unbanged import as a space binding", () => {
    const source = ['(import! &schema "../data/epilog-parts")', "!(match &schema ($x) $x)"].join(
      "\n",
    );

    expect(messagesFor(source, "space.unbound")).toEqual(["Unbound atom-space symbol '&schema'."]);
  });

  it("does not promote a deferred nested import to a top-level space binding", () => {
    const source = [
      '(= (load-schema) (import! &schema "../data/epilog-parts"))',
      "!(match &schema ($x) $x)",
    ].join("\n");

    expect(messagesFor(source, "space.unbound")).toEqual(["Unbound atom-space symbol '&schema'."]);
  });

  it("does not make an import target available to earlier top-level forms", () => {
    const source = ["!(match &schema ($x) $x)", '!(import! &schema "../data/epilog-parts")'].join(
      "\n",
    );

    expect(messagesFor(source, "space.unbound")).toEqual(["Unbound atom-space symbol '&schema'."]);
  });

  it("allows an explicit bind before import without reporting a duplicate", () => {
    const analyzer = analyzerFor(
      [
        "!(bind! &schema (new-space))",
        '!(import! &schema "../data/epilog-parts")',
        "!(match &schema ($x) $x)",
      ].join("\n"),
    );
    const codes = analyzer.validate(URI).map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("space.unbound");
    expect(codes).not.toContain("definition.duplicate");
  });

  it("keeps &self available across repeated imports", () => {
    const source = ['!(import! &self "one")', '!(import! &self "two")'].join("\n");
    const codes = analyzerFor(source)
      .validate(URI)
      .map((diagnostic) => diagnostic.code);

    expect(codes).not.toContain("space.unbound");
    expect(codes).not.toContain("definition.duplicate");
  });
});
