// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The pure LSP->ts converters that let a MeTTa language-service result be handed back to the TypeScript
// language server for an embedded template. No tsserver here: positions map through a plain body-offset
// function, and the `typescript` instance is passed in (the plugin uses tsserver's own instance).

import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentSymbol,
  type Hover,
  type Location,
  MarkupKind,
  type SignatureHelp,
  SymbolKind,
} from "vscode-languageserver-types";
import {
  bodyOffsetAt,
  lspCompletionsToTs,
  lspDefinitionsToTs,
  lspDiagnosticToTs,
  lspHoverToTs,
  lspSignatureHelpToTs,
  lspSymbolsToOutliningSpans,
  rangeToSpan,
  severityToCategory,
} from "../tsConversion.js";

const body = "(foo 1)\n(bar 2 3)";
const toOffset = (position: { line: number; character: number }): number =>
  bodyOffsetAt(position, body);

describe("bodyOffsetAt", () => {
  it("maps a line/character position to an absolute offset in the template body", () => {
    expect(bodyOffsetAt({ line: 0, character: 0 }, body)).toBe(0);
    expect(bodyOffsetAt({ line: 1, character: 0 }, body)).toBe(8); // just past "(foo 1)\n"
    expect(bodyOffsetAt({ line: 1, character: 1 }, body)).toBe(9); // the `b` of `bar`
  });
});

describe("severityToCategory", () => {
  it("maps LSP severities to ts.DiagnosticCategory the way the styled plugin does", () => {
    expect(severityToCategory(ts, DiagnosticSeverity.Error)).toBe(ts.DiagnosticCategory.Error);
    expect(severityToCategory(ts, DiagnosticSeverity.Warning)).toBe(ts.DiagnosticCategory.Warning);
    expect(severityToCategory(ts, DiagnosticSeverity.Information)).toBe(
      ts.DiagnosticCategory.Message,
    );
    expect(severityToCategory(ts, DiagnosticSeverity.Hint)).toBe(ts.DiagnosticCategory.Message);
    expect(severityToCategory(ts, undefined)).toBe(ts.DiagnosticCategory.Error);
  });
});

describe("lspDiagnosticToTs", () => {
  it("converts an LSP diagnostic into a ts.Diagnostic with body-relative start and length", () => {
    const diagnostic: Diagnostic = {
      range: { start: { line: 1, character: 1 }, end: { line: 1, character: 4 } },
      message: "unknown atom 'bar'",
      severity: DiagnosticSeverity.Warning,
      code: "undefined-symbol",
    };
    const out = lspDiagnosticToTs(ts, diagnostic, toOffset, undefined);
    expect(out.start).toBe(9);
    expect(out.length).toBe(3);
    expect(out.messageText).toBe("unknown atom 'bar'");
    expect(out.category).toBe(ts.DiagnosticCategory.Warning);
    expect(out.source).toBe("metta");
    // the pure converter leaves `file` for the service to fill from the template context
    expect(out.file).toBeUndefined();
  });
});

describe("rangeToSpan", () => {
  it("converts a body range to a start/length text span", () => {
    const span = rangeToSpan(
      { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
      toOffset,
    );
    expect(span).toStrictEqual({ start: 1, length: 3 });
  });
});

describe("lspCompletionsToTs", () => {
  it("maps completion items to entries with a mapped script-element kind", () => {
    const items: CompletionItem[] = [
      { label: "match", kind: CompletionItemKind.Keyword, sortText: "0" },
      { label: "greet", kind: CompletionItemKind.Function },
    ];
    const info = lspCompletionsToTs(ts, items, toOffset);
    expect(info.entries.map((entry) => entry.name)).toStrictEqual(["match", "greet"]);
    expect(info.entries[0]?.kind).toBe(ts.ScriptElementKind.keyword);
    expect(info.entries[1]?.kind).toBe(ts.ScriptElementKind.functionElement);
    // no textEdit -> no replacement span, and the label backfills sortText
    expect(info.entries[1]?.sortText).toBe("greet");
    expect(info.entries[1]?.replacementSpan).toBeUndefined();
  });

  it("derives a replacement span from a completion item's text edit", () => {
    const items: CompletionItem[] = [
      {
        label: "greet",
        textEdit: {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
          newText: "greet",
        },
      },
    ];
    expect(lspCompletionsToTs(ts, items, toOffset).entries[0]?.replacementSpan).toStrictEqual({
      start: 1,
      length: 3,
    });
  });
});

describe("lspHoverToTs", () => {
  it("returns undefined for no hover", () => {
    expect(lspHoverToTs(ts, null, toOffset)).toBeUndefined();
  });

  it("flattens hover markup into documentation parts with a text span", () => {
    const hover: Hover = {
      contents: { kind: MarkupKind.Markdown, value: "the `foo` function" },
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
    };
    const quick = lspHoverToTs(ts, hover, toOffset);
    expect(quick?.documentation?.map((part) => part.text).join("")).toContain("foo");
    expect(quick?.textSpan).toStrictEqual({ start: 1, length: 3 });
  });
});

describe("lspSignatureHelpToTs", () => {
  it("returns undefined when there are no signatures", () => {
    expect(lspSignatureHelpToTs({ signatures: [] }, { start: 0, length: 1 })).toBeUndefined();
  });

  it("maps each signature label into a prefix display part", () => {
    const help: SignatureHelp = {
      signatures: [{ label: "(-> Number Number)" }],
      activeSignature: 0,
      activeParameter: 0,
    };
    const items = lspSignatureHelpToTs(help, { start: 0, length: 7 });
    expect(items?.items[0]?.prefixDisplayParts.map((part) => part.text).join("")).toBe(
      "(-> Number Number)",
    );
    expect(items?.applicableSpan).toStrictEqual({ start: 0, length: 7 });
  });
});

describe("lspDefinitionsToTs", () => {
  it("maps locations to definition infos anchored in the host file", () => {
    const locations: Location[] = [
      {
        uri: "metta-embedded:/x.ts",
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 4 } },
      },
    ];
    const defs = lspDefinitionsToTs(ts, locations, "/x.ts", toOffset);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.fileName).toBe("/x.ts");
    expect(defs[0]?.textSpan).toStrictEqual({ start: 9, length: 3 });
  });
});

describe("lspSymbolsToOutliningSpans", () => {
  it("flattens the document-symbol tree into one outlining span per symbol", () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 1, character: 8 } };
    const child = { start: { line: 1, character: 0 }, end: { line: 1, character: 8 } };
    const symbols: DocumentSymbol[] = [
      {
        name: "double",
        kind: SymbolKind.Function,
        range,
        selectionRange: range,
        children: [
          { name: "(double $x)", kind: SymbolKind.Function, range: child, selectionRange: child },
        ],
      },
    ];
    const spans = lspSymbolsToOutliningSpans(ts, symbols, toOffset);
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.bannerText)).toStrictEqual(["double", "(double $x)"]);
  });
});
