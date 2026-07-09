// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Format MeTTa source in the block, width-driven style: a form that fits the target width prints on one line,
// and a form that overflows breaks with each argument on its own line indented by a fixed amount. Def-like
// heads (`=`, `:`) keep their name/pattern on the head line; other forms put the head alone with its
// arguments below. Built on core's recovering CST and the Wadler-Leijen `Doc` engine. Comments are attached
// to the nearest node and never dropped. Broken code (any parse diagnostic) is returned untouched, so the
// formatter never mangles a document it cannot fully understand.

import { type CstComment, parseCst, type SpannedNode, standardTokenizer } from "@metta-ts/core";
import {
  breakParent,
  concat,
  type Doc,
  fill,
  group,
  hardline,
  join,
  line,
  nest,
  render,
  text,
} from "./doc.js";

export interface FormatOptions {
  readonly width?: number;
  readonly indent?: number;
  // Override or extend the per-head "arguments kept on the head line" table. This is what a lint.metta config
  // feeds in, so a project can teach the formatter its own block forms.
  readonly headLineArgs?: Readonly<Record<string, number>>;
  // Extra symmetric forms (beyond the built-in set) whose arguments align under the first, from lint.metta.
  readonly alignForms?: readonly string[];
}

const TOKENIZER = standardTokenizer();

// Forms whose arguments are parallel/symmetric: they read best aligned under the first argument, so the
// columns line up (the "symmetry" a reader expects). `=` aligns its body under the pattern; `if` aligns its
// branches under the condition; `and`/`or`/comparisons/arithmetic align their operands; `->` aligns its
// argument types. Derived from MeTTa's semantics, not a copy of any one file.
const ALIGN_FORMS: ReadonlySet<string> = new Set([
  "=",
  "if",
  "and",
  "or",
  "==",
  "=alpha",
  "<",
  "<=",
  ">",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "->",
]);

// How many leading arguments stay on the head line for a BLOCK form when it breaks, keyed by head symbol.
// Block forms carry a trailing body/continuation that indents below the "setup" args (binding, subject,
// space). Derived from the MeTTa stdlib signatures. A head not listed and not an align form defaults to zero
// (head alone); a list of only simple atoms is laid out as a filled grid instead. Projects extend this via
// lint.metta.
const DEFAULT_HEAD_LINE_ARGS: Readonly<Record<string, number>> = {
  ":": 1,
  // pattern dispatch: subject/space stays, the body indents
  case: 1,
  switch: 1,
  match: 2,
  unify: 2,
  // conditionals with distinct setup and branches
  "if-error": 1,
  "if-empty": 1,
  "if-equal": 2,
  "if-decons-expr": 3,
  "return-on-error": 1,
  // binding and sequencing
  let: 2,
  "let*": 1,
  chain: 2,
  sealed: 1,
  // list transforms that carry a variable and a body
  "map-atom": 2,
  "filter-atom": 2,
  "foldl-atom": 4,
  // documentation forms
  "@doc": 1,
  "@doc-formal": 1,
};

function flatten(nodes: readonly SpannedNode[]): SpannedNode[] {
  const all: SpannedNode[] = [];
  const visit = (node: SpannedNode): void => {
    all.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes) visit(node);
  return all;
}

// Attach each comment to the node it belongs to: trailing the closest node that ends before it on the same
// line, otherwise leading the next node that starts after it, otherwise a dangling tail printed at the end.
function attachComments(
  comments: readonly CstComment[],
  nodes: readonly SpannedNode[],
  src: string,
  lineAt: (offset: number) => number,
): {
  leading: Map<SpannedNode, string[]>;
  trailing: Map<SpannedNode, string>;
  tail: string[];
} {
  const all = flatten(nodes);
  const leading = new Map<SpannedNode, string[]>();
  const trailing = new Map<SpannedNode, string>();
  const tail: string[] = [];
  for (const comment of comments) {
    const at = comment.span.start;
    const value = src.slice(comment.span.start, comment.span.end).trimEnd();
    let trail: SpannedNode | undefined;
    for (const node of all) {
      if (node.span.end <= at && lineAt(node.span.end) === lineAt(at)) {
        if (trail === undefined || node.span.end > trail.span.end) trail = node;
      }
    }
    if (trail !== undefined && !trailing.has(trail)) {
      trailing.set(trail, value);
      continue;
    }
    let lead: SpannedNode | undefined;
    for (const node of all) {
      if (node.span.start >= comment.span.end) {
        if (lead === undefined || node.span.start < lead.span.start) lead = node;
      }
    }
    if (lead !== undefined) {
      const existing = leading.get(lead) ?? [];
      existing.push(value);
      leading.set(lead, existing);
      continue;
    }
    tail.push(value);
  }
  return { leading, trailing, tail };
}

export function formatMetta(src: string, options: FormatOptions = {}): string {
  const width = options.width ?? 80;
  const indent = options.indent ?? 2;
  const headRules: Readonly<Record<string, number>> = {
    ...DEFAULT_HEAD_LINE_ARGS,
    ...(options.headLineArgs ?? {}),
  };
  const alignForms =
    options.alignForms !== undefined && options.alignForms.length > 0
      ? new Set([...ALIGN_FORMS, ...options.alignForms])
      : ALIGN_FORMS;
  const cst = parseCst(src, TOKENIZER);
  // Leave documents with syntax errors exactly as they are rather than risk reshaping broken structure.
  if (cst.diagnostics.length > 0) return src;
  if (cst.nodes.length === 0) return src.trim().length === 0 ? "" : `${src.trim()}\n`;

  const newlines: number[] = [];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) newlines.push(i);
  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((newlines[mid] ?? 0) < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const { leading, trailing, tail } = attachComments(cst.comments, cst.nodes, src, lineAt);
  const leaf = (node: SpannedNode): string => src.slice(node.span.start, node.span.end);

  // Align style: the first argument stays on the head line and every later argument lines up under it, so
  // parallel arguments form a column. The align column is the width of "(head " so broken lines sit exactly
  // under the first argument.
  function alignLayout(head: SpannedNode, rest: readonly SpannedNode[]): Doc {
    const alignColumn = leaf(head).length + 2;
    const parts: Doc[] = [text("("), docFor(head)];
    const first = rest[0];
    // The head keeps no argument beside it if a trailing comment ends its line, or if the first argument
    // carries a leading comment (hoisting it would drag that comment onto the head line and it would re-parse
    // as the head's trailing comment, so the layout would not be stable under reformatting).
    const headAlone = trailing.has(head) || (first !== undefined && leading.has(first));
    const below = headAlone ? rest : rest.slice(1);
    if (!headAlone && first !== undefined) parts.push(text(" "), docFor(first));
    if (below.length > 0)
      parts.push(nest(alignColumn, concat(below.map((child) => concat([line, docFor(child)])))));
    parts.push(text(")"));
    return group(concat(parts));
  }

  // How many of the requested leading arguments may actually share the head line: none if the head carries a
  // trailing comment; stop before any argument with a leading comment (which must start its own line) and
  // after any argument with a trailing comment (which must end its line).
  function keptOnHeadLine(
    head: SpannedNode,
    rest: readonly SpannedNode[],
    requested: number,
  ): number {
    if (trailing.has(head)) return 0;
    let kept = 0;
    for (let i = 0; i < requested; i++) {
      const arg = rest[i];
      if (arg === undefined || leading.has(arg)) break;
      kept = i + 1;
      if (trailing.has(arg)) break;
    }
    return kept;
  }

  // Block style: the setup arguments stay on the head line and the trailing body indents a fixed amount.
  function blockLayout(head: SpannedNode, rest: readonly SpannedNode[], onHeadLine: number): Doc {
    const kept = keptOnHeadLine(head, rest, onHeadLine);
    const parts: Doc[] = [text("("), docFor(head)];
    for (const arg of rest.slice(0, kept)) parts.push(text(" "), docFor(arg));
    const body = rest.slice(kept);
    if (body.length > 0)
      parts.push(nest(indent, concat(body.map((child) => concat([line, docFor(child)])))));
    parts.push(text(")"));
    return group(concat(parts));
  }

  // Data style: a tuple, not a call. If the author laid the elements out across several source rows (a board,
  // a matrix), keep those rows, since the 2-D shape carries meaning; only fix the indentation. A single-row
  // tuple fills into a width-sized grid instead. Wrapped/kept rows align under the first element.
  function dataLayout(children: readonly SpannedNode[]): Doc {
    const rows: SpannedNode[][] = [];
    let lastLine = -1;
    for (const child of children) {
      const childLine = lineAt(child.span.start);
      const current = rows[rows.length - 1];
      if (current === undefined || childLine !== lastLine) rows.push([child]);
      else current.push(child);
      lastLine = childLine;
    }
    if (rows.length > 1) {
      const rowDocs = rows.map((row) => join(text(" "), row.map(docFor)));
      return concat([text("("), nest(1, join(hardline, rowDocs)), text(")")]);
    }
    return concat([text("("), nest(1, fill(children.map(docFor))), text(")")]);
  }

  // The node's own layout (its group for an expression, its text for a leaf), before comments. The head
  // decides the style: a symmetric form aligns, a body form indents, a tuple (non-function head, or a run of
  // plain atoms) is data, and an unknown call puts the head alone with its arguments below.
  function formDoc(node: SpannedNode): Doc {
    if (node.kind !== "expr") return text(leaf(node));
    const children = node.children ?? [];
    const [head, ...rest] = children;
    if (head === undefined) return text("()");
    const headName = head.kind === "symbol" ? leaf(head) : "";
    if (alignForms.has(headName)) return alignLayout(head, rest);
    const rule = headRules[headName];
    if (rule !== undefined) return blockLayout(head, rest, Math.min(rule, rest.length));
    if (head.kind !== "symbol" || children.every((child) => child.kind !== "expr"))
      return dataLayout(children);
    return blockLayout(head, rest, 0);
  }

  // Wrap a node's layout with its comments. The trailing comment and its break-parent sit OUTSIDE the node's
  // own group, so they force the enclosing form to break (the next sibling drops to a new line) without
  // forcing this node itself to expand.
  function docFor(node: SpannedNode): Doc {
    const inner = formDoc(node);
    const trail = trailing.get(node);
    const withTrail =
      trail === undefined ? inner : concat([inner, text(" "), text(trail), breakParent]);
    const lead = leading.get(node) ?? [];
    if (lead.length === 0) return withTrail;
    return concat([...lead.flatMap((value) => [text(value), hardline]), withTrail]);
  }

  const nodeDoc = (node: SpannedNode): Doc => {
    const doc = docFor(node);
    return node.bang === true ? concat([text("!"), doc]) : doc;
  };

  const out: string[] = [];
  cst.nodes.forEach((node, index) => {
    const previous = cst.nodes[index - 1];
    if (previous !== undefined) {
      const between = src.slice(previous.span.end, node.span.start);
      // preserve a single blank line between forms when the source had one; otherwise pack them tight
      out.push(/\n[ \t]*\n/.test(between) ? "\n\n" : "\n");
    }
    out.push(render(nodeDoc(node), width));
  });
  if (tail.length > 0) out.push("\n", tail.join("\n"));
  out.push("\n");
  return out.join("");
}
