// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Render a MeTTa form as mixfix notation: the readable infix/keyword view over the S-expression. MeTTa is
// pure prefix with no operator precedence, so this imposes a standard one, the way Agda/Lean/Maude print
// notation over a core term language. `(if c a b)` reads `if c then a else b`, `(+ (* a b) c)` reads
// `a * b + c`, and `(f x y)` reads `f(x, y)`. A precedence-and-associativity-aware printer parenthesises only
// where a reader would otherwise misgroup. Pure and browser-safe: it reads the CST core produced and slices
// the source for atoms.

import { parseCst, type SpannedNode, standardTokenizer } from "@metta-ts/core";

const TOKENIZER = standardTokenizer();

// Precedences (higher binds tighter). A `f(x, y)` application is self-delimiting, so it never needs outer
// parentheses; `=`/`:` are loosest so a whole definition reads as one notation. `->` is variadic and
// right-associative, a curried function type.
const ARROW_PREC = 2;
const MIXFIX_PREC = 1;

type Assoc = "left" | "right" | "none";

interface InfixOp {
  readonly kind: "infix";
  readonly symbol: string;
  readonly prec: number;
  readonly assoc: Assoc;
}
interface PrefixOp {
  readonly kind: "prefix";
  readonly prec: number;
}
interface MixfixOp {
  readonly kind: "mixfix";
  readonly prec: number;
  readonly parts: readonly string[];
}
type Op = InfixOp | PrefixOp | MixfixOp;

const INFIX: Readonly<Record<string, { readonly prec: number; readonly assoc: Assoc }>> = {
  "*": { prec: 7, assoc: "left" },
  "/": { prec: 7, assoc: "left" },
  "%": { prec: 7, assoc: "left" },
  "+": { prec: 6, assoc: "left" },
  "-": { prec: 6, assoc: "left" },
  "==": { prec: 5, assoc: "none" },
  "!=": { prec: 5, assoc: "none" },
  "<": { prec: 5, assoc: "none" },
  ">": { prec: 5, assoc: "none" },
  "<=": { prec: 5, assoc: "none" },
  ">=": { prec: 5, assoc: "none" },
  and: { prec: 4, assoc: "left" },
  xor: { prec: 4, assoc: "left" },
  or: { prec: 3, assoc: "left" },
  "=": { prec: 1, assoc: "none" },
  ":": { prec: 1, assoc: "none" },
};

const PREFIX: Readonly<Record<string, number>> = {
  not: 8,
  superpose: 9,
  collapse: 9,
  quote: 9,
  unquote: 9,
};

// Keyword-delimited forms, keyed by `head/arity`. `_` marks an argument hole; the fixed tokens delimit it.
const MIXFIX: Readonly<Record<string, readonly string[]>> = {
  "if/2": ["if", "_", "then", "_"],
  "if/3": ["if", "_", "then", "_", "else", "_"],
  "let/3": ["let", "_", "=", "_", "in", "_"],
  "let*/2": ["let*", "_", "in", "_"],
  "match/3": ["match", "_", "with", "_", "=>", "_"],
  "case/2": ["case", "_", "of", "_"],
  "chain/3": ["chain", "_", "as", "_", "in", "_"],
};

function opFor(name: string, arity: number): Op | undefined {
  const mixfix = MIXFIX[`${name}/${String(arity)}`];
  if (mixfix) return { kind: "mixfix", prec: MIXFIX_PREC, parts: mixfix };
  const infix = INFIX[name];
  if (arity === 2 && infix !== undefined)
    return { kind: "infix", symbol: name, prec: infix.prec, assoc: infix.assoc };
  const prefix = PREFIX[name];
  if (arity === 1 && prefix !== undefined) return { kind: "prefix", prec: prefix };
  return undefined;
}

function atomText(node: SpannedNode, src: string): string {
  return src.slice(node.span.start, node.span.end);
}

function wrap(text: string, prec: number, ctx: number): string {
  return prec < ctx ? `(${text})` : text;
}

// A curried function type `(-> A B C)` reads `A -> B -> C`; a nested arrow argument parenthesises.
function renderArrow(args: readonly SpannedNode[], src: string, ctx: number): string {
  const chain = args.map((arg) => render(arg, src, ARROW_PREC + 1)).join(" -> ");
  return wrap(chain, ARROW_PREC, ctx);
}

function renderInfix(op: InfixOp, args: readonly SpannedNode[], src: string, ctx: number): string {
  const [left, right] = args;
  if (left === undefined || right === undefined) return "";
  const l = render(left, src, op.assoc === "left" ? op.prec : op.prec + 1);
  const r = render(right, src, op.assoc === "right" ? op.prec : op.prec + 1);
  return wrap(`${l} ${op.symbol} ${r}`, op.prec, ctx);
}

function renderMixfix(
  op: MixfixOp,
  args: readonly SpannedNode[],
  src: string,
  ctx: number,
): string {
  const pieces: string[] = [];
  let hole = 0;
  for (const piece of op.parts) {
    if (piece !== "_") {
      pieces.push(piece);
      continue;
    }
    const arg = args[hole];
    hole += 1;
    pieces.push(arg === undefined ? "?" : render(arg, src, op.prec + 1));
  }
  return wrap(pieces.join(" "), op.prec, ctx);
}

function render(node: SpannedNode, src: string, ctx: number): string {
  if (node.kind !== "expr") return atomText(node, src);
  const children = node.children ?? [];
  const head = children[0];
  if (head === undefined) return "()";
  const args = children.slice(1);
  if (head.kind === "symbol") {
    const name = atomText(head, src);
    if (name === "->" && args.length >= 2) return renderArrow(args, src, ctx);
    const op = opFor(name, args.length);
    if (op?.kind === "infix") return renderInfix(op, args, src, ctx);
    if (op?.kind === "mixfix") return renderMixfix(op, args, src, ctx);
    if (op?.kind === "prefix") {
      const arg = args[0];
      if (arg !== undefined) return wrap(`${name} ${render(arg, src, op.prec)}`, op.prec, ctx);
    }
    // Function application: `f(x, y)`, or a bare atom for a nullary head.
    return args.length === 0 ? name : `${name}(${args.map((a) => render(a, src, 0)).join(", ")})`;
  }
  // A non-symbol head is a data tuple: keep the parenthesised, space-separated shape.
  return `(${children.map((child) => render(child, src, 0)).join(" ")})`;
}

// Render a form node (from the analyzer's CST walk) as mixfix notation.
export function mixfixNode(node: SpannedNode, src: string): string {
  return render(node, src, 0);
}

// Parse a single form from source and render it as mixfix notation. Empty string when the source has no form.
export function toMixfix(formSrc: string): string {
  const node = parseCst(formSrc, TOKENIZER).nodes[0];
  return node === undefined ? "" : mixfixNode(node, formSrc);
}
