// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Structural search and replace over MeTTa. Find every form whose structure matches a pattern, and rewrite
// matches with a template that substitutes the captures. Code as data: the pattern and template are ordinary
// MeTTa terms, matched by the same engine the lint rules use, not text regexes or evaluated functions. A
// `$X` capture binds a subterm and reappears in the template; `$$$` matches a run of arguments.

import { parseCst, standardTokenizer } from "@metta-ts/core";
import { compilePattern, flatten, matchAt, renderFix } from "./lint/index.js";

const TOKENIZER = standardTokenizer();

export interface StructuralMatch {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// Every node whose structure matches `patternSrc`, in source order. Empty when the pattern is not exactly one
// well-formed form.
export function structuralSearch(source: string, patternSrc: string): StructuralMatch[] {
  const pattern = compilePattern(patternSrc);
  if (pattern === null) return [];
  const matches: StructuralMatch[] = [];
  for (const node of flatten(parseCst(source, TOKENIZER).nodes))
    if (matchAt(pattern, node, source) !== null)
      matches.push({
        start: node.span.start,
        end: node.span.end,
        text: source.slice(node.span.start, node.span.end),
      });
  return matches;
}

export interface StructuralReplaceResult {
  readonly text: string;
  readonly count: number;
}

// Replace every match of `patternSrc` with `templateSrc`, substituting the captured subterms. When a pattern
// matches both a form and a form nested inside it, the edits are applied non-overlapping and right-to-left,
// so offsets stay valid and no rewrite lands inside another.
export function structuralReplace(
  source: string,
  patternSrc: string,
  templateSrc: string,
): StructuralReplaceResult {
  const pattern = compilePattern(patternSrc);
  const template = compilePattern(templateSrc);
  if (pattern === null || template === null) return { text: source, count: 0 };
  const edits: { start: number; end: number; newText: string }[] = [];
  for (const node of flatten(parseCst(source, TOKENIZER).nodes)) {
    const binds = matchAt(pattern, node, source);
    if (binds !== null)
      edits.push({
        start: node.span.start,
        end: node.span.end,
        newText: renderFix(template, binds, source),
      });
  }
  edits.sort((a, b) => b.start - a.start);
  let text = source;
  let lastStart = Number.POSITIVE_INFINITY;
  let count = 0;
  for (const edit of edits) {
    if (edit.end > lastStart) continue;
    text = text.slice(0, edit.start) + edit.newText + text.slice(edit.end);
    lastStart = edit.start;
    count += 1;
  }
  return { text, count };
}
