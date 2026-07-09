// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Which top-level MeTTa forms Run can execute, and how a bare form becomes a query. Definition heads
// (=, :, macro, defmacro) and module directives (import!, include, include!, bind!) add to the space
// rather than reduce to results, so they are never offered as runnable and never bang-wrapped. Anything
// else evaluates once wrapped in a `!` bang; an existing `!` query runs as written.

import { headSymbol, parseMeTTa, semanticChildren } from "./parser.js";

const NON_RUNNABLE_HEADS: ReadonlySet<string> = new Set([
  "=",
  ":",
  "macro",
  "defmacro",
  "import!",
  "include",
  "include!",
  "bind!",
]);

// The heads a range evaluation prepends as context so a selection means what it means in the file: the
// non-runnable heads above plus pragma!, whose settings (e.g. limits) alter how later queries reduce.
export const EVALUATION_CONTEXT_HEADS: ReadonlySet<string> = new Set([
  ...NON_RUNNABLE_HEADS,
  "pragma!",
]);

export function isRunnableHead(head: string | null): boolean {
  return head === null || !NON_RUNNABLE_HEADS.has(head);
}

// Wrap a single bare expression in a `!` bang so evaluating it yields its results. Multi-form sources,
// already-banged sources, and non-runnable forms pass through unchanged.
export function wrapBareExpression(source: string): string {
  const trimmed = source.trim();
  if (!trimmed || trimmed.startsWith("!")) return source;
  const parsed = parseMeTTa("metta://guarded-evaluation/wrap-check", trimmed, null);
  const topLevel = semanticChildren(parsed.root);
  if (topLevel.length !== 1) return source;
  const only = topLevel[0];
  if (!only) return source;
  if (only.kind === "list" && !isRunnableHead(headSymbol(only))) return source;
  // A fused bang query (!word) after a leading comment is already banged.
  if (only.kind !== "list" && only.text.startsWith("!")) return source;
  // Insert the bang at the form itself so a leading comment stays a comment.
  return `${trimmed.slice(0, only.offsetStart)}!${trimmed.slice(only.offsetStart)}`;
}
