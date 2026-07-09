// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Pure converters from the MeTTa language service's LSP-typed results to the `ts.*` shapes the TypeScript
// language server expects for an embedded template. They mirror microsoft/typescript-styled-plugin's
// translation, but with no virtual-document wrapper: a MeTTa template body is already valid MeTTa, so
// positions map straight through a body-offset function. The `typescript` instance is a parameter so the
// plugin uses tsserver's own instance (enum identities must match) and so these stay unit-testable.

import type * as ts from "typescript";
import type {
  CodeAction,
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  MarkupContent,
  Position,
  Range,
  SignatureHelp,
} from "vscode-languageserver-types";
import { CompletionItemKind, DiagnosticSeverity } from "vscode-languageserver-types";
import { computeLineOffsets, offsetAt, positionAt } from "../server/parser.js";

// ts.Diagnostic.code is numeric; our diagnostics carry string codes (e.g. "undefined-symbol"), which live in
// the message instead. A single stable code tags every MeTTa diagnostic.
export const METTA_DIAGNOSTIC_CODE = 1_000_000;
const DIAGNOSTIC_SOURCE = "metta";

// The absolute offset of a body-relative position, using the body's own line map. Substitution preserves
// length, so this agrees with the decorator's `context.toOffset` on the substituted body.
export function bodyOffsetAt(position: Position, body: string): number {
  return offsetAt(position, computeLineOffsets(body), body.length);
}

// The body-relative position of an absolute body offset, for turning the decorator's offset-based code-fix
// range back into the line/character range the Analyzer works in.
export function bodyPositionAt(offset: number, body: string): Position {
  return positionAt(offset, computeLineOffsets(body));
}

// A body-relative position to an offset. The service passes the template context's `toOffset`; tests pass a
// `bodyOffsetAt` closure.
export type ToOffset = (position: Position) => number;

export function severityToCategory(
  typescript: typeof ts,
  severity: DiagnosticSeverity | undefined,
): ts.DiagnosticCategory {
  const category = typescript.DiagnosticCategory;
  if (severity === DiagnosticSeverity.Warning) return category.Warning;
  if (severity === DiagnosticSeverity.Information || severity === DiagnosticSeverity.Hint)
    return category.Message;
  return category.Error; // Error, and the unspecified case, surface as an error
}

export function lspDiagnosticToTs(
  typescript: typeof ts,
  diagnostic: Diagnostic,
  toOffset: ToOffset,
  file: ts.SourceFile | undefined,
): ts.Diagnostic {
  const start = toOffset(diagnostic.range.start);
  const length = Math.max(0, toOffset(diagnostic.range.end) - start);
  return {
    file,
    start,
    length,
    messageText:
      typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value,
    category: severityToCategory(typescript, diagnostic.severity),
    code: METTA_DIAGNOSTIC_CODE,
    source: DIAGNOSTIC_SOURCE,
  };
}

// A body-relative range to a `ts.TextSpan`.
export function rangeToSpan(range: Range, toOffset: ToOffset): ts.TextSpan {
  const start = toOffset(range.start);
  return { start, length: Math.max(0, toOffset(range.end) - start) };
}

function textPart(text: string): ts.SymbolDisplayPart {
  return { text, kind: "text" };
}

function markupText(documentation: string | MarkupContent): string {
  return typeof documentation === "string" ? documentation : documentation.value;
}

// Hover contents are a markup block, a marked string, or an array of either; flatten to display parts.
function hoverContentsToParts(contents: Hover["contents"]): ts.SymbolDisplayPart[] {
  const parts: ts.SymbolDisplayPart[] = [];
  const push = (piece: string | MarkupContent | { language: string; value: string }): void => {
    if (typeof piece === "string") parts.push(textPart(piece));
    else parts.push(textPart(piece.value));
  };
  if (Array.isArray(contents)) for (const piece of contents) push(piece);
  else push(contents);
  return parts;
}

// The LSP completion kind to the nearest TypeScript script-element kind, so an embedded MeTTa completion
// carries the right editor icon. A dense integer switch compiles to a jump table (no allocation, no hashing),
// the most efficient form. The `default` deliberately covers every LSP kind with no TypeScript analogue
// (Text, Unit, Snippet, Color, Event, Operator, and the unspecified kind); the exhaustiveness rule does not
// count a default as covering a union, so it is disabled here rather than padded to a 25-arm switch.
function completionKindToTs(
  typescript: typeof ts,
  kind: CompletionItemKind | undefined,
): ts.ScriptElementKind {
  const k = typescript.ScriptElementKind;
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check
  switch (kind) {
    case CompletionItemKind.Method:
      return k.memberFunctionElement;
    case CompletionItemKind.Function:
      return k.functionElement;
    case CompletionItemKind.Constructor:
      return k.constructorImplementationElement;
    case CompletionItemKind.Field:
    case CompletionItemKind.Property:
      return k.memberVariableElement;
    case CompletionItemKind.Variable:
      return k.variableElement;
    case CompletionItemKind.Class:
    case CompletionItemKind.Struct:
      return k.classElement;
    case CompletionItemKind.Interface:
      return k.interfaceElement;
    case CompletionItemKind.Module:
      return k.moduleElement;
    case CompletionItemKind.Enum:
      return k.enumElement;
    case CompletionItemKind.EnumMember:
      return k.enumMemberElement;
    case CompletionItemKind.Keyword:
      return k.keyword;
    case CompletionItemKind.File:
      return k.scriptElement;
    case CompletionItemKind.Reference:
      return k.alias;
    case CompletionItemKind.Folder:
      return k.directory;
    case CompletionItemKind.Value:
    case CompletionItemKind.Constant:
      return k.constElement;
    case CompletionItemKind.TypeParameter:
      return k.typeParameterElement;
    default:
      return k.unknown;
  }
}

function completionReplacementSpan(
  item: CompletionItem,
  toOffset: ToOffset,
): ts.TextSpan | undefined {
  const edit = item.textEdit;
  if (edit === undefined) return undefined;
  const range = "range" in edit ? edit.range : edit.replace;
  return rangeToSpan(range, toOffset);
}

export function lspCompletionsToTs(
  typescript: typeof ts,
  items: readonly CompletionItem[],
  toOffset: ToOffset,
): ts.WithMetadata<ts.CompletionInfo> {
  return {
    isGlobalCompletion: false,
    isMemberCompletion: false,
    isNewIdentifierLocation: false,
    entries: items.map((item) => ({
      name: item.label,
      kind: completionKindToTs(typescript, item.kind),
      kindModifiers: "",
      sortText: item.sortText ?? item.label,
      insertText: item.insertText,
      replacementSpan: completionReplacementSpan(item, toOffset),
    })),
  };
}

// A resolved completion's detail/documentation, for `getCompletionEntryDetails`.
export function lspCompletionDetails(
  typescript: typeof ts,
  item: CompletionItem,
): ts.CompletionEntryDetails {
  const documentation: ts.SymbolDisplayPart[] = [];
  if (item.detail !== undefined && item.detail.length > 0)
    documentation.push(textPart(item.detail));
  if (item.documentation !== undefined)
    documentation.push(textPart(markupText(item.documentation)));
  return {
    name: item.label,
    kind: completionKindToTs(typescript, item.kind),
    kindModifiers: "",
    displayParts: [],
    documentation,
  };
}

export function lspHoverToTs(
  typescript: typeof ts,
  hover: Hover | null,
  toOffset: ToOffset,
): ts.QuickInfo | undefined {
  if (hover === null) return undefined;
  return {
    kind: typescript.ScriptElementKind.unknown,
    kindModifiers: "",
    textSpan: hover.range ? rangeToSpan(hover.range, toOffset) : { start: 0, length: 1 },
    displayParts: [],
    documentation: hoverContentsToParts(hover.contents),
    tags: [],
  };
}

export function lspSignatureHelpToTs(
  help: SignatureHelp | null,
  applicableSpan: ts.TextSpan,
): ts.SignatureHelpItems | undefined {
  if (help === null || help.signatures.length === 0) return undefined;
  const selectedItemIndex = help.activeSignature ?? 0;
  return {
    items: help.signatures.map((signature) => ({
      isVariadic: false,
      prefixDisplayParts: [textPart(signature.label)],
      suffixDisplayParts: [],
      separatorDisplayParts: [],
      parameters: [],
      documentation:
        signature.documentation === undefined
          ? []
          : [textPart(markupText(signature.documentation))],
      tags: [],
    })),
    applicableSpan,
    selectedItemIndex,
    argumentIndex: help.activeParameter ?? 0,
    argumentCount: help.signatures[selectedItemIndex]?.parameters?.length ?? 0,
  };
}

export function lspDefinitionsToTs(
  typescript: typeof ts,
  locations: readonly Location[],
  fileName: string,
  toOffset: ToOffset,
): ts.DefinitionInfo[] {
  return locations.map((location) => ({
    fileName,
    textSpan: rangeToSpan(location.range, toOffset),
    kind: typescript.ScriptElementKind.unknown,
    name: "",
    containerKind: typescript.ScriptElementKind.unknown,
    containerName: "",
  }));
}

export function lspSymbolsToOutliningSpans(
  typescript: typeof ts,
  symbols: readonly DocumentSymbol[],
  toOffset: ToOffset,
): ts.OutliningSpan[] {
  const spans: ts.OutliningSpan[] = [];
  const visit = (symbol: DocumentSymbol): void => {
    const textSpan = rangeToSpan(symbol.range, toOffset);
    spans.push({
      textSpan,
      hintSpan: textSpan,
      bannerText: symbol.name,
      autoCollapse: false,
      kind: typescript.OutliningSpanKind.Region,
    });
    for (const child of symbol.children ?? []) visit(child);
  };
  for (const symbol of symbols) visit(symbol);
  return spans;
}

export function lspReferencesToTs(
  locations: readonly Location[],
  fileName: string,
  toOffset: ToOffset,
): ts.ReferenceEntry[] {
  return locations.map((location) => ({
    fileName,
    textSpan: rangeToSpan(location.range, toOffset),
    isWriteAccess: false,
    isDefinition: false,
  }));
}

// A MeTTa quick-fix (did-you-mean, wrap-in-`!`, add type declaration, ...) as a `ts.CodeFixAction`. Only the
// edits the action makes to this template's own document survive; the decorator repositions each span into
// the host `.ts` file, and cross-file edits (which cannot be mapped into a template) are dropped.
export function lspCodeActionsToTs(
  actions: readonly CodeAction[],
  uri: string,
  fileName: string,
  toOffset: ToOffset,
): ts.CodeFixAction[] {
  const fixes: ts.CodeFixAction[] = [];
  for (const action of actions) {
    const edits = action.edit?.changes?.[uri];
    if (edits === undefined || edits.length === 0) continue;
    fixes.push({
      fixName: DIAGNOSTIC_SOURCE,
      description: action.title,
      changes: [
        {
          fileName,
          textChanges: edits.map((edit) => ({
            span: rangeToSpan(edit.range, toOffset),
            newText: edit.newText,
          })),
        },
      ],
    });
  }
  return fixes;
}
