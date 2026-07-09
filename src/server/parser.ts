// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The LSP parse layer. `parseMeTTa` is a thin adapter over @metta-ts/core's recovering span CST
// (`parseCst`): the tree, tokens, and diagnostics are all built from the interpreter's own reader, so the
// server can never disagree with the real parser about where a token starts, what an atom is, or how a
// broken document recovers. The pure position/range helpers below operate on text and line offsets only and
// are representation-independent. The `!` bang is split back into a standalone `symbol` (core folds it into
// a bang flag), reproducing the LSP's historical tree shape exactly; only semanticTokens depends on a `!`
// token existing so it highlights as a keyword.

import {
  type Cst,
  type CstComment,
  parseCst,
  type SpannedNode,
  standardTokenizer,
} from "@metta-ts/core";
import type { Position, Range } from "vscode-languageserver-types";
import {
  type AstNode,
  compareRange,
  type ParseDiagnostic,
  type ParseResult,
  rangeContainsPosition,
  rangeLengthScore,
  type Token,
} from "./types.js";

const TOKENIZER = standardTokenizer();

export function computeLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      offsets.push(i + 1);
    } else if (text.charCodeAt(i) === 10) {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

export function positionAt(offset: number, lineOffsets: readonly number[]): Position {
  let low = 0;
  let high = lineOffsets.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midOffset = lineOffsets[mid] ?? 0;
    if (midOffset > offset) high = mid;
    else low = mid + 1;
  }
  const line = Math.max(0, low - 1);
  return { line, character: Math.max(0, offset - (lineOffsets[line] ?? 0)) };
}

export function offsetAt(
  position: Position,
  lineOffsets: readonly number[],
  textLength = Number.MAX_SAFE_INTEGER,
): number {
  if (lineOffsets.length === 0) return 0;
  const line = Math.max(0, Math.min(position.line, lineOffsets.length - 1));
  const lineStart = lineOffsets[line] ?? 0;
  const nextLineStart =
    line + 1 < lineOffsets.length ? (lineOffsets[line + 1] ?? textLength) : textLength;
  return Math.max(lineStart, Math.min(lineStart + position.character, nextLineStart));
}

export function rangeFromOffsets(
  start: number,
  end: number,
  lineOffsets: readonly number[],
): Range {
  return { start: positionAt(start, lineOffsets), end: positionAt(end, lineOffsets) };
}

// A leaf kind is both a Token type and an AstNode kind, so the adapter uses one value for the token and the
// node it produces.
type LeafKind = "symbol" | "variable" | "string" | "number";

// Map a CST leaf's syntactic kind to the leaf kind. `expr` never reaches here (lists are built from
// open/close tokens), so it collapses to "symbol" only defensively.
function leafTokenType(kind: SpannedNode["kind"]): LeafKind {
  return kind === "variable" || kind === "string" || kind === "number" ? kind : "symbol";
}

// A leaf CST node is a bare word that fuses with an immediately preceding top-level `!`, exactly as the old
// lexer did: `!foo`, `!42`, `!$x` were single symbol tokens, while `!(...)`, `! foo`, and `!"s"` were not.
function bangFusesWith(node: SpannedNode): boolean {
  return (
    (node.kind === "symbol" || node.kind === "variable" || node.kind === "number") &&
    node.bangSpan !== undefined &&
    node.bangSpan.end === node.span.start
  );
}

interface Builder {
  readonly text: string;
  readonly lineOffsets: readonly number[];
  readonly comments: readonly CstComment[];
  readonly tokens: Token[];
  commentIndex: number;
}

function makeToken(
  type: Token["type"],
  text: string,
  start: number,
  end: number,
  lineOffsets: readonly number[],
): Token {
  const base: Token = {
    type,
    text,
    range: rangeFromOffsets(start, end, lineOffsets),
    offsetStart: start,
    offsetEnd: end,
  };
  if (type === "open") return { ...base, open: text as "(" };
  if (type === "close") return { ...base, close: text as ")" };
  return base;
}

function pushToken(builder: Builder, type: Token["type"], start: number, end: number): Token {
  const token = makeToken(type, builder.text.slice(start, end), start, end, builder.lineOffsets);
  builder.tokens.push(token);
  return token;
}

function makeLeafNode(
  builder: Builder,
  kind: AstNode["kind"],
  start: number,
  end: number,
  parent: AstNode,
): AstNode {
  return {
    kind,
    text: builder.text.slice(start, end),
    range: rangeFromOffsets(start, end, builder.lineOffsets),
    offsetStart: start,
    offsetEnd: end,
    children: [],
    parent,
  };
}

// Attach every comment that begins before `offset` as an interleaved child of `parent`, emitting a comment
// token for each. Comments are kept as tree children (not only tokens) because the doc-comment extractor
// reads a definition's preceding siblings.
function drainCommentsBefore(builder: Builder, offset: number, parent: AstNode): void {
  for (;;) {
    const comment = builder.comments[builder.commentIndex];
    if (comment === undefined || comment.span.start >= offset) break;
    builder.commentIndex += 1;
    const token = pushToken(builder, "comment", comment.span.start, comment.span.end);
    const node = makeLeafNode(builder, "comment", comment.span.start, comment.span.end, parent);
    node.range = token.range;
    parent.children.push(node);
  }
}

// Build an AstNode (and its tokens) for one CST node, recursing into expressions and interleaving comments.
function buildNode(builder: Builder, cst: SpannedNode, parent: AstNode): AstNode {
  if (cst.kind === "expr") {
    const open = cst.open ?? cst.span;
    const openToken = pushToken(builder, "open", open.start, open.end);
    const node: AstNode = {
      kind: "list",
      text: builder.text.slice(cst.span.start, cst.span.end),
      range: rangeFromOffsets(cst.span.start, cst.span.end, builder.lineOffsets),
      offsetStart: cst.span.start,
      offsetEnd: cst.span.end,
      children: [],
      parent,
      openToken,
    };
    for (const child of cst.children ?? []) {
      drainCommentsBefore(builder, child.span.start, node);
      node.children.push(buildNode(builder, child, node));
    }
    const contentEnd = cst.close ? cst.close.start : cst.span.end;
    drainCommentsBefore(builder, contentEnd, node);
    if (cst.close) node.closeToken = pushToken(builder, "close", cst.close.start, cst.close.end);
    return node;
  }
  const type = leafTokenType(cst.kind);
  pushToken(builder, type, cst.span.start, cst.span.end);
  return makeLeafNode(builder, type, cst.span.start, cst.span.end, parent);
}

export function parseMeTTa(uri: string, text: string, version: number | null = null): ParseResult {
  const lineOffsets = computeLineOffsets(text);
  const cst: Cst = parseCst(text, TOKENIZER);
  const root: AstNode = {
    kind: "program",
    text,
    range: rangeFromOffsets(0, text.length, lineOffsets),
    offsetStart: 0,
    offsetEnd: text.length,
    children: [],
  };
  const builder: Builder = {
    text,
    lineOffsets,
    comments: cst.comments,
    tokens: [],
    commentIndex: 0,
  };

  // Record each top-level form's bang status by its start offset, so the analyzer can tell `!(import! …)`
  // (a run query) from `(import! …)` (inert data that never loads the module).
  const topLevelBangs = new Map<number, boolean>();
  for (const top of cst.nodes) {
    if (top.bang === true && top.bangSpan !== undefined) {
      if (bangFusesWith(top)) {
        const start = top.bangSpan.start;
        const end = top.span.end;
        drainCommentsBefore(builder, start, root);
        pushToken(builder, "symbol", start, end);
        const node = makeLeafNode(builder, "symbol", start, end, root);
        root.children.push(node);
        topLevelBangs.set(node.offsetStart, true);
        continue;
      }
      drainCommentsBefore(builder, top.bangSpan.start, root);
      pushToken(builder, "symbol", top.bangSpan.start, top.bangSpan.end);
      root.children.push(
        makeLeafNode(builder, "symbol", top.bangSpan.start, top.bangSpan.end, root),
      );
      drainCommentsBefore(builder, top.span.start, root);
      const node = buildNode(builder, top, root);
      root.children.push(node);
      topLevelBangs.set(node.offsetStart, true);
      continue;
    }
    drainCommentsBefore(builder, top.span.start, root);
    const node = buildNode(builder, top, root);
    root.children.push(node);
    topLevelBangs.set(node.offsetStart, false);
  }
  drainCommentsBefore(builder, text.length + 1, root);

  const diagnostics: ParseDiagnostic[] = cst.diagnostics.map((diagnostic) => ({
    range: rangeFromOffsets(diagnostic.span.start, diagnostic.span.end, lineOffsets),
    message: diagnostic.message,
    severity: diagnostic.severity,
    code: diagnostic.code,
  }));

  return {
    uri,
    text,
    version,
    root,
    tokens: builder.tokens,
    diagnostics,
    lineOffsets,
    topLevelBangs,
  };
}

export function semanticChildren(node: AstNode): AstNode[] {
  return node.children.filter((child) => child.kind !== "comment");
}

export function nodeTextWithoutQuotes(node: AstNode): string {
  if (node.kind === "string" && node.text.length >= 2) {
    return node.text
      .slice(1, -1)
      .replaceAll('\\"', '"')
      .replaceAll("\\n", "\n")
      .replaceAll("\\t", "\t");
  }
  return node.text;
}

export function getSymbolText(node: AstNode | undefined): string | null {
  if (!node) return null;
  if (
    node.kind === "symbol" ||
    node.kind === "variable" ||
    node.kind === "number" ||
    node.kind === "string"
  )
    return node.text;
  if (node.kind === "list") {
    const first = semanticChildren(node)[0];
    if (first?.kind === "symbol" || first?.kind === "variable") return first.text;
  }
  return null;
}

export function headSymbol(listNode: AstNode): string | null {
  if (listNode.kind !== "list") return null;
  const first = semanticChildren(listNode)[0];
  if (!first) return null;
  if (first.kind === "symbol") return first.text;
  return null;
}

export function walkAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const child of node.children) walkAst(child, visit);
}

export function findNodeAtPosition(
  root: AstNode,
  position: Position,
  predicate?: (node: AstNode) => boolean,
): AstNode | null {
  const matches: AstNode[] = [];
  walkAst(root, (node) => {
    if (!rangeContainsPosition(node.range, position)) return;
    if (predicate && !predicate(node)) return;
    matches.push(node);
  });
  matches.sort((a, b) => {
    const byLength = rangeLengthScore(a.range) - rangeLengthScore(b.range);
    if (byLength !== 0) return byLength;
    return compareRange(a.range, b.range);
  });
  return matches[0] ?? null;
}

export function findTokenAtPosition(tokens: readonly Token[], position: Position): Token | null {
  // Ranges are end-inclusive, so at a boundary between two tokens the left one (which merely ends there)
  // and the right one (which starts there) both contain the position. Prefer the token that does not just
  // end at the position, so a cursor on a symbol's first character resolves to the symbol, not the `(`.
  const inside = tokens.find(
    (tok) =>
      rangeContainsPosition(tok.range, position) &&
      !(position.line === tok.range.end.line && position.character === tok.range.end.character),
  );
  if (inside) return inside;
  // A cursor just past a token's last character (end of a symbol with nothing after it) still resolves to it.
  return (
    tokens.find(
      (tok) =>
        tok.range.start.line === position.line && tok.range.end.character === position.character,
    ) ?? null
  );
}

export function nearestAncestor(
  node: AstNode | null | undefined,
  predicate: (node: AstNode) => boolean,
): AstNode | null {
  let current: AstNode | undefined = node ?? undefined;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

export function lineText(text: string, line: number): string {
  const lines = text.split(/\r?\n/);
  return lines[line] ?? "";
}

export function fullRangeForText(text: string): Range {
  const offsets = computeLineOffsets(text);
  return rangeFromOffsets(0, text.length, offsets);
}
