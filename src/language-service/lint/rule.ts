// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Syntactic lint rules, authored in MeTTa and matched by the structural matcher. A rule is a flat form:
//
//   (lint-rule constant-if-true
//     (pattern (if True $Then $Else))
//     (message "the condition is always true, so this reduces to its then-branch")
//     (severity warn)
//     (fix $Then))
//
// (pattern ...) is required; (message ...) is required; (severity ...) defaults to warn. Relational clauses
// refine the match, sharing its captures: (not-in-file P) fires only when no node in the file matches P,
// (has P)/(not-has P) test the matched subtree, and (metavariable-regex $X R) filters a capture by source
// text. (fix T) renders a replacement by substituting captures into a template, becoming a code action.
// {$NAME} in a message interpolates a capture.

import {
  type Cst,
  type CstComment,
  parseCst,
  type SpannedNode,
  standardTokenizer,
} from "@metta-ts/core";
import type { LintSeverity } from "../config.js";
import {
  type Binding,
  type Bindings,
  compilePatternNode,
  matchAt,
  type PatternNode,
} from "./pattern.js";

export type Constraint =
  | {
      readonly kind: "not-in-file" | "has" | "not-has";
      readonly pattern: PatternNode;
    }
  | {
      readonly kind: "metavariable-regex";
      readonly name: string;
      readonly regex: RegExp;
      readonly source: string;
    };

export interface LintRule {
  readonly id: string;
  readonly message: string;
  readonly severity: LintSeverity;
  readonly pattern: PatternNode;
  readonly constraints: readonly Constraint[];
  readonly fix?: PatternNode;
}

export interface LintFix {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

export interface LintFinding {
  readonly ruleId: string;
  readonly message: string;
  readonly severity: LintSeverity;
  readonly start: number;
  readonly end: number;
  readonly fix?: LintFix;
}

export interface RuleIssue {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface RuleParseResult {
  readonly rules: readonly LintRule[];
  readonly suppresses: readonly SuppressRule[];
  readonly issues: readonly RuleIssue[];
}

// A code-as-data suppression from lint.metta: `(suppress <pattern> <code>...)` silences the listed diagnostic
// codes (or every code, when none are given) on any form the pattern matches. The pattern is matched
// structurally by the engine the lint rules use, so a suppression is data, not an evaluated function.
export interface SuppressRule {
  readonly pattern: PatternNode;
  readonly codes: ReadonlySet<string> | "all";
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TOKENIZER = standardTokenizer();
const SEVERITIES = new Set<string>(["deny", "warn", "allow", "off"]);
const CONSTRAINT_KINDS = new Set<string>(["not-in-file", "has", "not-has"]);
const REGEX_CONSTRAINT_KINDS = new Set<string>(["metavariable-regex", "regex"]);
const MAX_REGEX_TARGET_LENGTH = 4096;

// One validate parses the same document source several times — for findings, for pattern suppression, and for
// comment suppression. Memoize the last parse (a pure cache: a miss just parses) so those collapse to one.
// Callers only read the CST (flatten / parseSuppressions), so sharing one instance is safe.
let lastDocSrc: string | undefined;
let lastDocCst: Cst | undefined;
function parseDoc(src: string): Cst {
  if (src === lastDocSrc && lastDocCst !== undefined) return lastDocCst;
  lastDocCst = parseCst(src, TOKENIZER);
  lastDocSrc = src;
  return lastDocCst;
}

export function flatten(nodes: readonly SpannedNode[]): SpannedNode[] {
  const all: SpannedNode[] = [];
  const visit = (node: SpannedNode): void => {
    all.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return all;
}

export function parseRules(src: string): RuleParseResult {
  const cst: Cst = parseCst(src, TOKENIZER);
  const rules: LintRule[] = [];
  const suppresses: SuppressRule[] = [];
  const issues: RuleIssue[] = [];
  const leaf = (node: SpannedNode): string => src.slice(node.span.start, node.span.end);
  const fail = (node: SpannedNode, message: string): void => {
    issues.push({ message, start: node.span.start, end: node.span.end });
  };
  for (const diagnostic of cst.diagnostics)
    issues.push({
      message: diagnostic.message,
      start: diagnostic.span.start,
      end: diagnostic.span.end,
    });

  for (const node of cst.nodes) {
    if (node.kind !== "expr") continue;
    const children = node.children ?? [];
    const [head, id, ...clauses] = children;
    if (head === undefined || head.kind !== "symbol") continue;
    const headText = leaf(head);
    if (headText === "suppress") {
      const patternNode = children[1];
      if (patternNode === undefined || patternNode.kind !== "expr") {
        fail(node, "suppress needs a pattern: (suppress (<form> ...) [code...])");
        continue;
      }
      const codeSyms = children
        .slice(2)
        .filter((n) => n.kind === "symbol")
        .map((n) => leaf(n));
      suppresses.push({
        pattern: compilePatternNode(patternNode, src),
        codes: codeSyms.length === 0 ? "all" : new Set(codeSyms),
        text: leaf(node),
        start: node.span.start,
        end: node.span.end,
      });
      continue;
    }
    if (headText !== "lint-rule") continue;
    if (id === undefined || id.kind !== "symbol") {
      fail(node, "lint-rule needs an identifier: (lint-rule <id> (pattern ...) ...)");
      continue;
    }
    let pattern: PatternNode | undefined;
    let message: string | undefined;
    let severity: LintSeverity = "warn";
    let fix: PatternNode | undefined;
    const constraints: Constraint[] = [];
    const ruleIssues: RuleIssue[] = [];
    const clauseFail = (badNode: SpannedNode, messageText: string): void => {
      const issue = { message: messageText, start: badNode.span.start, end: badNode.span.end };
      issues.push(issue);
      ruleIssues.push(issue);
    };
    for (const clause of clauses) {
      const clauseChildren = clause.kind === "expr" ? (clause.children ?? []) : [];
      const keyNode = clauseChildren[0];
      const key = keyNode === undefined ? "" : leaf(keyNode);
      const arg = clauseChildren[1];
      if (clause.kind !== "expr" || keyNode === undefined || arg === undefined) {
        clauseFail(clause, `malformed clause in rule ${leaf(id)}`);
        continue;
      }
      if (key === "pattern") pattern = compilePatternNode(arg, src);
      else if (key === "fix") fix = compilePatternNode(arg, src);
      else if (key === "message") message = arg.kind === "string" ? unquote(leaf(arg)) : leaf(arg);
      else if (key === "severity") {
        const level = leaf(arg);
        if (SEVERITIES.has(level)) severity = level as LintSeverity;
        else clauseFail(arg, `unknown severity ${level} in rule ${leaf(id)}`);
      } else if (CONSTRAINT_KINDS.has(key))
        constraints.push({
          kind: key as "not-in-file" | "has" | "not-has",
          pattern: compilePatternNode(arg, src),
        });
      else if (REGEX_CONSTRAINT_KINDS.has(key)) {
        const parsed = parseRegexConstraint(clause, clauseChildren.slice(1), src, leaf, clauseFail);
        if (parsed !== null) constraints.push(parsed);
      } else clauseFail(clause, `unknown clause ${key} in rule ${leaf(id)}`);
    }
    if (pattern === undefined || message === undefined) {
      fail(node, `rule ${leaf(id)} needs a (pattern ...) and a (message ...)`);
      continue;
    }
    if (ruleIssues.length > 0) continue;
    rules.push({ id: leaf(id), message, severity, pattern, constraints, fix });
  }
  return { rules, suppresses, issues };
}

function unquote(text: string): string {
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

function stringLiteralValue(node: SpannedNode, src: string): string | null {
  if (node.kind !== "string") return null;
  const atom = node.atom;
  return atom.kind === "gnd" && atom.value.g === "str"
    ? atom.value.s
    : unquote(src.slice(node.span.start, node.span.end));
}

function captureName(node: SpannedNode, src: string): string | null {
  if (node.kind !== "variable") return null;
  const text = src.slice(node.span.start, node.span.end);
  const name = text.startsWith("$") ? text.slice(1) : text;
  if (name === "_" || name.length === 0) return null;
  if (name.startsWith("$$")) {
    const variadicName = name.slice(2);
    return variadicName.length > 0 ? variadicName : null;
  }
  return /^[A-Z]/.test(name) ? name : null;
}

function parseRegexConstraint(
  node: SpannedNode,
  args: readonly SpannedNode[],
  src: string,
  leaf: (node: SpannedNode) => string,
  fail: (node: SpannedNode, message: string) => void,
): Constraint | null {
  const [target, pattern] = args;
  if (target === undefined || pattern === undefined || args.length !== 2) {
    fail(node, 'metavariable-regex expects a capture and a regex: (metavariable-regex $X "^foo")');
    return null;
  }
  const name = captureName(target, src);
  if (name === null) {
    fail(target, `metavariable-regex target must name a capture, got ${leaf(target)}`);
    return null;
  }
  const source = stringLiteralValue(pattern, src);
  if (source === null) {
    fail(pattern, `metavariable-regex pattern must be a string, got ${leaf(pattern)}`);
    return null;
  }
  try {
    return { kind: "metavariable-regex", name, regex: new RegExp(source), source };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(pattern, `invalid regex ${JSON.stringify(source)}: ${message}`);
    return null;
  }
}

// Suppression directives parsed from comments: a whole-file switch, file-wide rule ids, and per-line rule
// ids. A `; @suppress <rules>` comment silences those rules on its own line and the next (covering both the
// trailing `(form) ; @suppress` and the leading `; @suppress\n(form)` shapes); `; @suppress-file [<rules>]`
// silences them for the whole file, all rules when no ids are given.
export interface Suppressions {
  readonly fileAll: boolean;
  readonly fileRules: ReadonlySet<string>;
  readonly byLine: ReadonlyMap<number, ReadonlySet<string> | "all">;
}

// A 0-based line lookup for a source offset, by binary search over newline positions.
function makeLineAt(src: string): (offset: number) => number {
  const newlines: number[] = [];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) newlines.push(i);
  return (offset) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((newlines[mid] ?? 0) < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

function parseSuppressions(
  comments: readonly CstComment[],
  src: string,
  lineAt: (offset: number) => number,
): Suppressions {
  const fileRules = new Set<string>();
  let fileAll = false;
  const byLine = new Map<number, Set<string> | "all">();
  const addLine = (line: number, rules: readonly string[]): void => {
    if (rules.length === 0) {
      byLine.set(line, "all");
      return;
    }
    const existing = byLine.get(line);
    if (existing === "all") return;
    const set = existing ?? new Set<string>();
    for (const rule of rules) set.add(rule);
    byLine.set(line, set);
  };
  for (const comment of comments) {
    const text = src.slice(comment.span.start, comment.span.end);
    const at = text.indexOf("@suppress");
    if (at === -1) continue;
    let rest = text.slice(at + "@suppress".length);
    const isFile = rest.startsWith("-file");
    if (isFile) rest = rest.slice("-file".length);
    // Reject @suppressfoo / @suppress-filefoo: the directive must end at a non-word character.
    if (/^\w/.test(rest)) continue;
    const rules = rest
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (isFile) {
      if (rules.length === 0) fileAll = true;
      else for (const rule of rules) fileRules.add(rule);
    } else {
      const line = lineAt(comment.span.start);
      addLine(line, rules);
      addLine(line + 1, rules);
    }
  }
  return { fileAll, fileRules, byLine };
}

export type InlineSuppressionKind = "line" | "file";

// Which inline directive, if any, silences `code` at 0-based `line`: a whole-file `@suppress-file` or a
// per-line `@suppress`. `isSuppressed` is the boolean view the lint pass uses.
export function inlineSuppression(
  code: string,
  line: number,
  suppressions: Suppressions,
): InlineSuppressionKind | null {
  if (suppressions.fileAll || suppressions.fileRules.has(code)) return "file";
  const entry = suppressions.byLine.get(line);
  if (entry === "all" || (entry !== undefined && entry.has(code))) return "line";
  return null;
}

export function isSuppressed(ruleId: string, line: number, suppressions: Suppressions): boolean {
  return inlineSuppression(ruleId, line, suppressions) !== null;
}

// Parse the `; @suppress` / `; @suppress-file` directives from a source string. `applyRules` uses the
// internal path for lint findings; the analyzer calls this to silence ANY diagnostic by its code with the
// same comment vocabulary, so a user suppresses `symbol.possibleTypo` the same way they suppress a lint rule.
export function buildSuppressions(src: string): Suppressions {
  const cst = parseDoc(src);
  return parseSuppressions(cst.comments, src, makeLineAt(src));
}

export interface PatternSuppressionSpan {
  readonly start: number;
  readonly end: number;
  readonly codes: ReadonlySet<string> | "all";
  readonly rule: SuppressRule;
}

// Match each `(suppress <pattern> ...)` rule structurally against every node of `src`, returning the spans
// of the matched forms with the codes each silences. A diagnostic whose offset falls inside such a span,
// and whose code the span covers, is suppressed.
export function patternSuppressionSpans(
  src: string,
  rules: readonly SuppressRule[],
): PatternSuppressionSpan[] {
  if (rules.length === 0) return [];
  const cst = parseDoc(src);
  const all = flatten(cst.nodes);
  const spans: PatternSuppressionSpan[] = [];
  for (const rule of rules)
    for (const node of all)
      if (matchAt(rule.pattern, node, src) !== null)
        spans.push({ start: node.span.start, end: node.span.end, codes: rule.codes, rule });
  return spans;
}

export interface LintResult {
  readonly findings: LintFinding[];
  readonly suppressed: LintFinding[];
}

// Run every rule over a document. `off`/`allow` severities are dropped entirely; the rest are partitioned in
// source order into findings and those a `; @suppress` directive silenced, so a caller can report what was
// hidden. `applyRules` is the findings-only view.
export function applyRulesTracked(rules: readonly LintRule[], docSrc: string): LintResult {
  const cst = parseDoc(docSrc);
  const all = flatten(cst.nodes);
  const lineAt = makeLineAt(docSrc);
  const suppressions = parseSuppressions(cst.comments, docSrc, lineAt);
  const findings: LintFinding[] = [];
  const suppressed: LintFinding[] = [];
  for (const rule of rules) {
    if (rule.severity === "off" || rule.severity === "allow") continue;
    for (const node of all) {
      const binds = matchAt(rule.pattern, node, docSrc);
      if (binds === null) continue;
      if (!satisfiesConstraints(rule.constraints, node, all, docSrc, binds)) continue;
      const finding: LintFinding = {
        ruleId: rule.id,
        message: interpolate(rule.message, binds, docSrc),
        severity: rule.severity,
        start: node.span.start,
        end: node.span.end,
        ...(rule.fix === undefined
          ? {}
          : {
              fix: {
                start: node.span.start,
                end: node.span.end,
                newText: renderFix(rule.fix, binds, docSrc),
              },
            }),
      };
      if (isSuppressed(rule.id, lineAt(node.span.start), suppressions)) suppressed.push(finding);
      else findings.push(finding);
    }
  }
  const bySpan = (a: LintFinding, b: LintFinding): number =>
    a.start === b.start ? a.end - b.end : a.start - b.start;
  findings.sort(bySpan);
  suppressed.sort(bySpan);
  return { findings, suppressed };
}

export function applyRules(rules: readonly LintRule[], docSrc: string): LintFinding[] {
  return applyRulesTracked(rules, docSrc).findings;
}

function satisfiesConstraints(
  constraints: readonly Constraint[],
  node: SpannedNode,
  all: readonly SpannedNode[],
  src: string,
  binds: Bindings,
): boolean {
  const subtree = flatten([node]);
  for (const constraint of constraints) {
    if (constraint.kind === "metavariable-regex") {
      if (!satisfiesRegexConstraint(constraint, binds, src)) return false;
      continue;
    }
    const scope = constraint.kind === "not-in-file" ? all : subtree;
    const found = scope.some(
      (candidate) => matchAt(constraint.pattern, candidate, src, binds) !== null,
    );
    if (constraint.kind === "has" ? !found : found) return false;
  }
  return true;
}

function satisfiesRegexConstraint(
  constraint: Extract<Constraint, { readonly kind: "metavariable-regex" }>,
  binds: Bindings,
  src: string,
): boolean {
  const bound = binds.get(constraint.name);
  if (bound === undefined) return false;
  const text = bindingText(bound, src);
  if (text.length > MAX_REGEX_TARGET_LENGTH) return false;
  const match = constraint.regex.exec(text);
  return match !== null && match.index === 0;
}

function interpolate(message: string, binds: Bindings, src: string): string {
  return message.replaceAll(/\{\$([^}]+)\}/g, (whole, name: string) => {
    const bound = binds.get(name);
    return bound === undefined ? whole : bindingText(bound, src);
  });
}

function bindingText(binding: Binding, src: string): string {
  const nodes = "one" in binding ? [binding.one] : binding.many;
  return nodes.map((node) => src.slice(node.span.start, node.span.end)).join(" ");
}

// Render a fix template by substituting captures. A zero-length ellipsis contributes nothing, so the joined
// child list carries no stray spaces. `src` is the document the captures were bound in (a metavar renders as
// the source text of the node it matched), so structural replace passes the SEARCHED source here.
export function renderFix(pattern: PatternNode, binds: Bindings, src: string): string {
  switch (pattern.kind) {
    case "leaf":
      return pattern.text;
    case "literalVar":
      return `$${pattern.name}`;
    case "wildcard":
      return "$_";
    case "metavar": {
      const bound = binds.get(pattern.name);
      return bound === undefined ? `$${pattern.name}` : bindingText(bound, src);
    }
    case "variadic": {
      const bound = pattern.name === null ? undefined : binds.get(pattern.name);
      return bound === undefined ? "" : bindingText(bound, src);
    }
    case "expr": {
      const parts = pattern.children
        .map((child) => renderFix(child, binds, src))
        .filter((part) => part.length > 0);
      return `(${parts.join(" ")})`;
    }
  }
}
