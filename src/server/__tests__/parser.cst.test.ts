// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// parseMeTTa is an adapter over @metta-ts/core's recovering span CST. The full feature suite is the
// behavioral differential; these tests pin the parse-layer contract the adapter must keep: the flat token
// stream includes parens and comments, comments stay interleaved as tree children (the doc-comment
// extractor depends on it), the `!` bang is split back into a standalone symbol, and malformed source
// recovers into a tree plus diagnostics instead of throwing.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { parseMeTTa, semanticChildren } from "../parser.js";

const parse = (text: string) => parseMeTTa("metta://cst/input.metta", text, 1);

describe("parseMeTTa adapter over the core CST", () => {
  it("emits a flat token stream with parens and leaf kinds", () => {
    const { tokens } = parse("(f $x 1)");
    expect(tokens.map((t) => t.type)).toStrictEqual([
      "open",
      "symbol",
      "variable",
      "number",
      "close",
    ]);
    expect(tokens.map((t) => t.text)).toStrictEqual(["(", "f", "$x", "1", ")"]);
  });

  it("builds a list node whose children are the semantic atoms", () => {
    const { root } = parse("(= (f $x) $x)");
    expect(root.kind).toBe("program");
    const [list] = root.children;
    expect(list?.kind).toBe("list");
    expect(semanticChildren(list!).map((c) => c.kind)).toStrictEqual([
      "symbol",
      "list",
      "variable",
    ]);
    expect(list?.parent).toBe(root);
  });

  it("keeps comments interleaved as tree children in source order", () => {
    const { root, tokens } = parse("; a leading note\n(= (f) 1)");
    expect(root.children[0]?.kind).toBe("comment");
    expect(root.children[0]?.text).toBe("; a leading note");
    expect(root.children[1]?.kind).toBe("list");
    expect(tokens.some((t) => t.type === "comment")).toBe(true);
  });

  it("attaches a comment inside a list to that list", () => {
    const { root } = parse("(f ; inner\n 1)");
    const [list] = root.children;
    expect(list?.children.map((c) => c.kind)).toStrictEqual(["symbol", "comment", "number"]);
  });

  it("splits a bang query into a standalone symbol and the form", () => {
    const { root, tokens } = parse("!(foo 1)");
    expect(root.children.map((c) => c.kind)).toStrictEqual(["symbol", "list"]);
    expect(root.children[0]?.text).toBe("!");
    expect(tokens[0]).toMatchObject({ type: "symbol", text: "!" });
  });

  it("fuses a bang that abuts a bare word, matching the historical lexer", () => {
    const { root } = parse("!foo");
    expect(root.children.map((c) => c.kind)).toStrictEqual(["symbol"]);
    expect(root.children[0]?.text).toBe("!foo");
  });

  it("recovers from an unclosed paren with a diagnostic and a tree", () => {
    const { root, diagnostics } = parse("(f (g 1)");
    expect(diagnostics.map((d) => d.code)).toContain("syntax.unclosedDelimiter");
    expect(diagnostics.every((d) => d.severity === DiagnosticSeverity.Error)).toBe(true);
    expect(root.children[0]?.kind).toBe("list");
  });

  it("recovers from an unterminated string", () => {
    const { diagnostics } = parse('(greet "hi');
    expect(diagnostics.map((d) => d.code)).toContain("syntax.unterminatedString");
  });
});
