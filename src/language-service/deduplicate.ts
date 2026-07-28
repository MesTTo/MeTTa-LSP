// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// MeTTa-aware clone detection. jscpd finds repeated token windows; this detector uses the interpreter's
// atoms instead, so comments, layout, and consistent logic-variable renaming do not hide the same term.
// Hashes only select candidates. atomEq verifies every bucket because structural hashes may collide.

import {
  type Atom,
  atomEq,
  atomSize,
  canonicalize,
  hashOf,
  parseCst,
  type SpannedNode,
  standardTokenizer,
} from "@metta-ts/core";

const TOKENIZER = standardTokenizer();

export type SemanticRole = "data" | "declaration" | "executable" | "pattern" | "quoted" | "type";

type ChildMode = "binding-list" | "binding-pair" | "case-arm" | "case-list" | null;

export interface DeduplicateDocument {
  readonly uri: string;
  readonly text: string;
}

export interface DeduplicateOptions {
  readonly minAtoms?: number;
  readonly minLines?: number;
}

export interface CloneOccurrence {
  readonly uri: string;
  readonly start: number;
  readonly end: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly atoms: number;
  readonly lines: number;
  readonly role: SemanticRole;
  readonly text: string;
}

export interface SemanticClone {
  readonly id: string;
  readonly kind: "exact" | "alpha-equivalent";
  readonly atoms: number;
  readonly lines: number;
  readonly role: SemanticRole;
  readonly occurrences: readonly CloneOccurrence[];
}

export interface DeduplicateIssue {
  readonly uri: string;
  readonly code: string;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface DeduplicateStats {
  readonly files: number;
  readonly totalAtoms: number;
  readonly duplicateAtoms: number;
  readonly duplicateAtomPercent: number;
  readonly totalLines: number;
  readonly duplicateLines: number;
  readonly duplicateLinePercent: number;
  readonly clones: number;
  readonly occurrences: number;
}

export interface DeduplicateResult {
  readonly complete: boolean;
  readonly clones: readonly SemanticClone[];
  readonly issues: readonly DeduplicateIssue[];
  readonly stats: DeduplicateStats;
}

interface LocatedNode {
  readonly key: string;
  readonly uri: string;
  readonly text: string;
  readonly node: SpannedNode;
  readonly normalized: Atom;
  readonly role: SemanticRole;
  readonly atomIds: readonly string[];
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

interface MutableGroup {
  readonly representative: LocatedNode;
  readonly occurrences: LocatedNode[];
}

function lineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 13 && text.charCodeAt(index + 1) === 10) index += 1;
    if (text.charCodeAt(index) === 10 || text.charCodeAt(index) === 13) offsets.push(index + 1);
  }
  return offsets;
}

function positionAt(offset: number, offsets: readonly number[]): [number, number] {
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((offsets[middle] ?? 0) > offset) high = middle;
    else low = middle + 1;
  }
  const line = Math.max(0, low - 1);
  return [line + 1, offset - (offsets[line] ?? 0) + 1];
}

function childContext(
  node: SpannedNode,
  role: SemanticRole,
  childIndex: number,
  mode: ChildMode,
): { readonly role: SemanticRole; readonly mode: ChildMode } {
  if (mode === "case-list")
    return { role: "data", mode: node.children?.[childIndex]?.kind === "expr" ? "case-arm" : null };
  if (mode === "case-arm") return { role: childIndex === 0 ? "pattern" : "executable", mode: null };
  if (mode === "binding-list")
    return {
      role: "data",
      mode: node.children?.[childIndex]?.kind === "expr" ? "binding-pair" : null,
    };
  if (mode === "binding-pair")
    return { role: childIndex === 0 ? "pattern" : "executable", mode: null };
  if (role === "quoted" || role === "type" || role === "pattern") return { role, mode: null };
  const head = node.atom.kind === "expr" ? node.atom.items[0] : undefined;
  const name = head?.kind === "sym" ? head.name : "";
  if (name === "quote") return { role: childIndex === 0 ? role : "quoted", mode: null };
  if (name === ":") return { role: childIndex === 0 ? "declaration" : "type", mode: null };
  if (name === "=") {
    if (childIndex === 0) return { role: "declaration", mode: null };
    return { role: childIndex === 1 ? "pattern" : "executable", mode: null };
  }
  if (name === "match") {
    if (childIndex === 2) return { role: "pattern", mode: null };
    if (childIndex === 3) return { role: "executable", mode: null };
  }
  if (name === "case") {
    if (childIndex === 1) return { role: "executable", mode: null };
    if (childIndex === 2) return { role: "data", mode: "case-list" };
  }
  if (name === "let") {
    if (childIndex === 1) return { role: "pattern", mode: null };
    if (childIndex >= 2) return { role: "executable", mode: null };
  }
  if (name === "let*") {
    if (childIndex === 1) return { role: "data", mode: "binding-list" };
    if (childIndex === 2) return { role: "executable", mode: null };
  }
  return { role, mode: null };
}

function collectAtomIds(node: SpannedNode, uri: string, out: string[]): void {
  out.push(`${uri}:${node.span.start}:${node.span.end}`);
  for (const child of node.children ?? []) collectAtomIds(child, uri, out);
}

function collectLocated(
  node: SpannedNode,
  document: DeduplicateDocument,
  offsets: readonly number[],
  role: SemanticRole,
  out: LocatedNode[],
  mode: ChildMode = null,
): void {
  const nextRole = node.bang === true ? "executable" : role;
  if (node.kind === "expr") {
    const [startLine, startColumn] = positionAt(node.span.start, offsets);
    const [endLine, endColumn] = positionAt(node.span.end, offsets);
    const atomIds: string[] = [];
    collectAtomIds(node, document.uri, atomIds);
    const normalized = canonicalize(node.atom, new Map());
    out.push({
      key: `${nextRole}:${atomSize(node.atom)}:${hashOf(normalized)}`,
      uri: document.uri,
      text: document.text.slice(node.span.start, node.span.end),
      node,
      normalized,
      role: nextRole,
      atomIds,
      startLine,
      startColumn,
      endLine,
      endColumn,
    });
  }
  for (const [index, child] of (node.children ?? []).entries()) {
    const context = childContext(node, nextRole, index, mode);
    collectLocated(child, document, offsets, context.role, out, context.mode);
  }
}

function occurrence(node: LocatedNode): CloneOccurrence {
  return {
    uri: node.uri,
    start: node.node.span.start,
    end: node.node.span.end,
    startLine: node.startLine,
    startColumn: node.startColumn,
    endLine: node.endLine,
    endColumn: node.endColumn,
    atoms: atomSize(node.node.atom),
    lines: node.endLine - node.startLine + 1,
    role: node.role,
    text: node.text,
  };
}

function contains(outer: LocatedNode, inner: LocatedNode): boolean {
  return (
    outer.uri === inner.uri &&
    outer.node.span.start <= inner.node.span.start &&
    outer.node.span.end >= inner.node.span.end
  );
}

function isCoveredByLargerGroup(group: MutableGroup, accepted: readonly MutableGroup[]): boolean {
  return accepted.some(
    (larger) =>
      atomSize(larger.representative.node.atom) > atomSize(group.representative.node.atom) &&
      group.occurrences.every((inner) =>
        larger.occurrences.some((outer) => contains(outer, inner)),
      ),
  );
}

function roundedPercent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 10_000) / 100;
}

function sortLocated(left: LocatedNode, right: LocatedNode): number {
  const uriOrder = left.uri.localeCompare(right.uri);
  if (uriOrder !== 0) return uriOrder;
  const startOrder = left.node.span.start - right.node.span.start;
  return startOrder !== 0 ? startOrder : left.node.span.end - right.node.span.end;
}

export function deduplicate(
  documents: readonly DeduplicateDocument[],
  options: DeduplicateOptions = {},
): DeduplicateResult {
  const minAtoms = Math.max(1, Math.trunc(options.minAtoms ?? 8));
  const minLines = Math.max(1, Math.trunc(options.minLines ?? 1));
  const issues: DeduplicateIssue[] = [];
  const candidates: LocatedNode[] = [];
  const totalAtomIds = new Set<string>();
  let totalLines = 0;

  for (const document of [...documents].sort((a, b) => a.uri.localeCompare(b.uri))) {
    const parsed = parseCst(document.text, TOKENIZER);
    totalLines += document.text.length === 0 ? 0 : document.text.split(/\r\n?|\n/u).length;
    if (parsed.diagnostics.length > 0) {
      for (const diagnostic of parsed.diagnostics)
        issues.push({
          uri: document.uri,
          code: diagnostic.code,
          message: diagnostic.message,
          start: diagnostic.span.start,
          end: diagnostic.span.end,
        });
      continue;
    }
    const offsets = lineOffsets(document.text);
    for (const top of parsed.nodes) {
      const ids: string[] = [];
      collectAtomIds(top, document.uri, ids);
      for (const id of ids) totalAtomIds.add(id);
      const head = top.atom.kind === "expr" ? top.atom.items[0] : undefined;
      const declaration =
        head?.kind === "sym" && ["=", ":", "defmacro", "macro"].includes(head.name);
      collectLocated(
        top,
        document,
        offsets,
        top.bang === true ? "executable" : declaration ? "declaration" : "data",
        candidates,
      );
    }
  }

  const buckets = new Map<string, MutableGroup[]>();
  for (const candidate of candidates) {
    if (atomSize(candidate.node.atom) < minAtoms) continue;
    if (candidate.endLine - candidate.startLine + 1 < minLines) continue;
    const groups = buckets.get(candidate.key) ?? [];
    const existing = groups.find((group) =>
      atomEq(group.representative.normalized, candidate.normalized),
    );
    if (existing === undefined)
      groups.push({ representative: candidate, occurrences: [candidate] });
    else existing.occurrences.push(candidate);
    buckets.set(candidate.key, groups);
  }

  const groups = [...buckets.values()]
    .flat()
    .filter((group) => group.occurrences.length > 1)
    .map((group) => ({
      ...group,
      occurrences: [...group.occurrences].sort(sortLocated),
    }))
    .sort((left, right) => {
      const sizeOrder =
        atomSize(right.representative.node.atom) - atomSize(left.representative.node.atom);
      return sizeOrder !== 0 ? sizeOrder : sortLocated(left.representative, right.representative);
    });
  const accepted: MutableGroup[] = [];
  for (const group of groups) if (!isCoveredByLargerGroup(group, accepted)) accepted.push(group);

  const duplicateAtomIds = new Set<string>();
  const duplicateLineIds = new Set<string>();
  const clones = accepted
    .sort((left, right) => sortLocated(left.representative, right.representative))
    .map((group, index): SemanticClone => {
      for (const duplicate of group.occurrences.slice(1)) {
        for (const id of duplicate.atomIds) duplicateAtomIds.add(id);
        for (let line = duplicate.startLine; line <= duplicate.endLine; line++)
          duplicateLineIds.add(`${duplicate.uri}:${line}`);
      }
      const exact = group.occurrences.every((item) =>
        atomEq(group.representative.node.atom, item.node.atom),
      );
      return {
        id: `clone-${String(index + 1).padStart(4, "0")}`,
        kind: exact ? "exact" : "alpha-equivalent",
        atoms: atomSize(group.representative.node.atom),
        lines: group.representative.endLine - group.representative.startLine + 1,
        role: group.representative.role,
        occurrences: group.occurrences.map(occurrence),
      };
    });

  return {
    complete: issues.length === 0,
    clones,
    issues,
    stats: {
      files: documents.length,
      totalAtoms: totalAtomIds.size,
      duplicateAtoms: duplicateAtomIds.size,
      duplicateAtomPercent: roundedPercent(duplicateAtomIds.size, totalAtomIds.size),
      totalLines,
      duplicateLines: duplicateLineIds.size,
      duplicateLinePercent: roundedPercent(duplicateLineIds.size, totalLines),
      clones: clones.length,
      occurrences: clones.reduce((sum, clone) => sum + clone.occurrences.length, 0),
    },
  };
}
