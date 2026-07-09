// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Structural pattern matching over the span-CST, the engine of the syntactic linter. The pattern language is
// MeTTa itself (the target language), following the ast-grep/Semgrep convention adapted to MeTTa's `$` sigil
// and disambiguated by case:
//
//   $NAME   (uppercase)  captures one node, and must match the same node everywhere it repeats
//   $_                   matches one node, capturing nothing
//   $$$ / $$$NAME        matches zero or more consecutive nodes in a list (an ellipsis), optionally captured
//   $name   (lowercase)  matches a literal MeTTa variable of exactly that name
//
// core's unifier can express ordinary `$X` capture and repeated-variable equality. The full lint language
// still needs its own CST matcher because it distinguishes lint captures from literal source variables,
// supports ellipses, and yields source spans for diagnostics and fixes. The algorithm itself is standard
// ellipsis backtracking. Everything here is pure and browser-safe: it reads the CST core already produced.

import { parseCst, type SpannedNode, standardTokenizer } from "@metta-ts/core";

// A compiled pattern node, independent of the pattern's own source text.
export type PatternNode =
  | { readonly kind: "metavar"; readonly name: string }
  | { readonly kind: "wildcard" }
  | { readonly kind: "variadic"; readonly name: string | null }
  | { readonly kind: "literalVar"; readonly name: string }
  | {
      readonly kind: "leaf";
      readonly nodeKind: "symbol" | "number" | "string";
      readonly text: string;
    }
  | { readonly kind: "expr"; readonly children: readonly PatternNode[] };

// Each metavar binds to the node it captured; each ellipsis binds to the (possibly empty) run of nodes.
export type Binding = { readonly one: SpannedNode } | { readonly many: readonly SpannedNode[] };
export type Bindings = ReadonlyMap<string, Binding>;

const TOKENIZER = standardTokenizer();

// Classify a variable's source text into the pattern role its shape denotes.
function classifyVariable(text: string): PatternNode {
  const name = text.startsWith("$") ? text.slice(1) : text;
  if (name === "_") return { kind: "wildcard" };
  if (name.startsWith("$$")) {
    const captured = name.slice(2);
    return { kind: "variadic", name: captured.length > 0 ? captured : null };
  }
  if (/^[A-Z]/.test(name)) return { kind: "metavar", name };
  return { kind: "literalVar", name };
}

// Compile a pattern from a CST node already parsed (a rule's sub-form), without re-parsing its text.
export function compilePatternNode(node: SpannedNode, src: string): PatternNode {
  return compileNode(node, src);
}

function compileNode(node: SpannedNode, src: string): PatternNode {
  const text = src.slice(node.span.start, node.span.end);
  if (node.kind === "variable") return classifyVariable(text);
  if (node.kind === "expr")
    return {
      kind: "expr",
      children: (node.children ?? []).map((child) => compileNode(child, src)),
    };
  return { kind: "leaf", nodeKind: node.kind, text };
}

// Compile a pattern from its MeTTa source, or null if the source is not exactly one well-formed form.
export function compilePattern(patternSrc: string): PatternNode | null {
  const cst = parseCst(patternSrc, TOKENIZER);
  if (cst.diagnostics.length > 0 || cst.nodes.length !== 1) return null;
  const [root] = cst.nodes;
  return root === undefined ? null : compileNode(root, patternSrc);
}

// Two captured leaf/expr nodes are "the same" when their source text is identical (a metavar that repeats must
// bind the same subterm). Comparing text is exact for the CST's canonical spans.
function sameText(a: SpannedNode, b: SpannedNode, leafOf: (node: SpannedNode) => string): boolean {
  return leafOf(a) === leafOf(b);
}

// Match a single pattern node against a single target node, extending `binds`. On failure `binds` may hold
// partial bindings; callers that backtrack snapshot it first.
function matchNode(
  pattern: PatternNode,
  target: SpannedNode,
  binds: Map<string, Binding>,
  leafOf: (node: SpannedNode) => string,
): boolean {
  switch (pattern.kind) {
    case "wildcard":
      return true;
    case "metavar": {
      const existing = binds.get(pattern.name);
      if (existing !== undefined)
        return "one" in existing && sameText(existing.one, target, leafOf);
      binds.set(pattern.name, { one: target });
      return true;
    }
    case "literalVar":
      return target.kind === "variable" && leafOf(target) === `$${pattern.name}`;
    case "variadic":
      // An ellipsis only has meaning inside a list; matched against a lone node it never applies.
      return false;
    case "leaf":
      return target.kind === pattern.nodeKind && leafOf(target) === pattern.text;
    case "expr":
      return (
        target.kind === "expr" &&
        matchSequence(pattern.children, target.children ?? [], 0, 0, binds, leafOf)
      );
  }
}

// Match a pattern child sequence against a target child sequence, where a `variadic` pattern consumes zero or
// more consecutive target nodes. Backtracks over how many nodes each ellipsis consumes.
function matchSequence(
  patterns: readonly PatternNode[],
  targets: readonly SpannedNode[],
  pi: number,
  ti: number,
  binds: Map<string, Binding>,
  leafOf: (node: SpannedNode) => string,
): boolean {
  if (pi === patterns.length) return ti === targets.length;
  const pattern = patterns[pi];
  if (pattern === undefined) return false;
  if (pattern.kind === "variadic") {
    for (let take = 0; ti + take <= targets.length; take++) {
      const snapshot = new Map(binds);
      if (pattern.name !== null) binds.set(pattern.name, { many: targets.slice(ti, ti + take) });
      if (matchSequence(patterns, targets, pi + 1, ti + take, binds, leafOf)) return true;
      restore(binds, snapshot);
    }
    return false;
  }
  if (ti >= targets.length) return false;
  const here = targets[ti];
  if (here === undefined) return false;
  const snapshot = new Map(binds);
  if (
    matchNode(pattern, here, binds, leafOf) &&
    matchSequence(patterns, targets, pi + 1, ti + 1, binds, leafOf)
  )
    return true;
  restore(binds, snapshot);
  return false;
}

function restore(binds: Map<string, Binding>, snapshot: Map<string, Binding>): void {
  binds.clear();
  for (const [key, value] of snapshot) binds.set(key, value);
}

// Try to match `pattern` at exactly `target`. Returns the bindings on success, or null. A `seed` pre-binds
// metavariables shared with an earlier match (so a `not-in-file` check can require the same $F).
export function matchAt(
  pattern: PatternNode,
  target: SpannedNode,
  src: string,
  seed?: Bindings,
): Bindings | null {
  const leafOf = (node: SpannedNode): string => src.slice(node.span.start, node.span.end);
  const binds = new Map<string, Binding>(seed);
  return matchNode(pattern, target, binds, leafOf) ? binds : null;
}
