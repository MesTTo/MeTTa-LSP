// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Equality-saturation simplification for MeTTa atoms. The e-graph keeps equivalent terms in one e-class
// and extracts the lowest-cost member. Every equality is admitted by the MeTTa evaluator itself, then the
// final edit is replayed against the same declaration context. User rules can override built-ins or add
// nondeterministic answers, so a rewrite that merely looks algebraically valid is never enough.

import {
  type Atom,
  alphaEq,
  analyzePurity,
  atomEq,
  atomSize,
  buildEnv,
  canonicalize,
  expr,
  format,
  IMPURE_OPS,
  isTableSafeGroundedOp,
  parseCst,
  runProgram,
  type SpannedNode,
  standardTokenizer,
  stdTable,
} from "@metta-ts/core";

const TOKENIZER = standardTokenizer();
const GROUNDINGS = stdTable();
const PURE_SPECIAL_FORMS = new Set(["case", "if", "let", "let*", "quote"]);
const SIMPLIFIER_IMPURE_OPS = new Set([
  ...IMPURE_OPS,
  ...[...GROUNDINGS].flatMap(([name, grounding]) =>
    isTableSafeGroundedOp(name, grounding) ? [] : [name],
  ),
]);

export interface SimplifyOptions {
  readonly context?: string;
  readonly fuel?: number;
  readonly maxIterations?: number;
  readonly maxNodes?: number;
  readonly range?: { readonly start: number; readonly end: number };
}

export interface SimplificationStep {
  readonly rule: "metta.reduce";
  readonly before: string;
  readonly after: string;
  readonly results: readonly string[];
}

export interface SimplificationProof {
  readonly strategy: "equality-saturation";
  readonly contextHash: string;
  readonly original: string;
  readonly simplified: string;
  readonly originalResults: readonly string[];
  readonly simplifiedResults: readonly string[];
  readonly steps: readonly SimplificationStep[];
  readonly iterations: number;
  readonly eClasses: number;
  readonly eNodes: number;
  readonly verified: true;
}

export interface Simplification {
  readonly before: string;
  readonly after: string;
  readonly proof: SimplificationProof;
}

export interface SimplificationEdit extends Simplification {
  readonly start: number;
  readonly end: number;
}

export interface SimplificationIssue {
  readonly code: "parse-error" | "invalid-selection" | "verification-failed";
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface SimplifyDocumentResult {
  readonly complete: boolean;
  readonly text: string;
  readonly edits: readonly SimplificationEdit[];
  readonly issues: readonly SimplificationIssue[];
}

interface ELeaf {
  readonly kind: "leaf";
  readonly atom: Atom;
}

interface EApplication {
  readonly kind: "application";
  readonly children: readonly number[];
}

type ENode = ELeaf | EApplication;

interface EClass {
  readonly id: number;
  readonly nodes: ENode[];
}

interface Reduction {
  readonly before: Atom;
  readonly after: Atom;
  readonly results: readonly Atom[];
}

interface EvaluationContext {
  readonly source: string;
  readonly fuel: number;
  readonly pureFunctions: ReadonlySet<string>;
  readonly definedFunctions: ReadonlySet<string>;
  readonly openWorld: boolean;
}

class UnionFind {
  private readonly parents: number[] = [];
  private readonly ranks: number[] = [];

  public makeSet(): number {
    const id = this.parents.length;
    this.parents.push(id);
    this.ranks.push(0);
    return id;
  }

  public find(id: number): number {
    const parent = this.parents[id];
    if (parent === undefined) throw new Error(`unknown e-class ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parents[id] = root;
    return root;
  }

  public union(left: number, right: number): { readonly root: number; readonly changed: boolean } {
    let leftRoot = this.find(left);
    let rightRoot = this.find(right);
    if (leftRoot === rightRoot) return { root: leftRoot, changed: false };
    if ((this.ranks[leftRoot] ?? 0) < (this.ranks[rightRoot] ?? 0))
      [leftRoot, rightRoot] = [rightRoot, leftRoot];
    this.parents[rightRoot] = leftRoot;
    if ((this.ranks[leftRoot] ?? 0) === (this.ranks[rightRoot] ?? 0))
      this.ranks[leftRoot] = (this.ranks[leftRoot] ?? 0) + 1;
    return { root: leftRoot, changed: true };
  }
}

function atomCost(atom: Atom): readonly [number, number, string] {
  const rendered = format(atom);
  return [atomSize(atom), rendered.length, rendered];
}

function lowerCost(left: Atom, right: Atom): boolean {
  const a = atomCost(left);
  const b = atomCost(right);
  return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
}

function sameNode(left: ENode, right: ENode): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "leaf" && right.kind === "leaf") return atomEq(left.atom, right.atom);
  if (left.kind !== "application" || right.kind !== "application") return false;
  return (
    left.children.length === right.children.length &&
    left.children.every((child, index) => child === right.children[index])
  );
}

class AtomEGraph {
  private readonly unionFind = new UnionFind();
  private readonly classes = new Map<number, EClass>();
  private readonly reductions: Reduction[] = [];

  public addAtom(atom: Atom): number {
    if (atom.kind !== "expr") return this.addNode({ kind: "leaf", atom });
    return this.addNode({
      kind: "application",
      children: atom.items.map((item) => this.addAtom(item)),
    });
  }

  public merge(left: number, right: number): boolean {
    const merged = this.unionFind.union(left, right);
    if (!merged.changed) return false;
    this.compactClasses();
    return true;
  }

  public addReduction(before: Atom, after: Atom, results: readonly Atom[]): boolean {
    const left = this.addAtom(before);
    const right = this.addAtom(after);
    const changed = this.merge(left, right);
    if (changed) this.reductions.push({ before, after, results });
    return changed;
  }

  public rebuild(): boolean {
    let changed = false;
    for (;;) {
      this.compactClasses();
      const seen: { readonly node: ENode; readonly id: number }[] = [];
      let merged = false;
      for (const eClass of this.rootClasses()) {
        for (const rawNode of eClass.nodes) {
          const node = this.canonicalNode(rawNode);
          const existing = seen.find((entry) => sameNode(entry.node, node));
          if (existing === undefined) seen.push({ node, id: eClass.id });
          else if (this.merge(existing.id, eClass.id)) {
            merged = true;
            changed = true;
            break;
          }
        }
        if (merged) break;
      }
      if (!merged) break;
    }
    this.compactClasses();
    return changed;
  }

  public extract(id: number): Atom | null {
    const best = new Map<number, Atom>();
    const classes = this.rootClasses();
    for (const eClass of classes)
      for (const node of eClass.nodes)
        if (node.kind === "leaf") {
          const prior = best.get(eClass.id);
          if (prior === undefined || lowerCost(node.atom, prior)) best.set(eClass.id, node.atom);
        }
    for (let pass = 0; pass <= classes.length; pass++) {
      let changed = false;
      for (const eClass of classes) {
        for (const node of eClass.nodes) {
          if (node.kind !== "application") continue;
          const children = node.children.map((child) => best.get(this.unionFind.find(child)));
          if (children.includes(undefined)) continue;
          const candidate = expr(children as Atom[]);
          const prior = best.get(eClass.id);
          if (prior === undefined || lowerCost(candidate, prior)) {
            best.set(eClass.id, candidate);
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return best.get(this.unionFind.find(id)) ?? null;
  }

  public entries(): readonly EClass[] {
    return this.rootClasses();
  }

  public reductionSteps(): readonly Reduction[] {
    return this.reductions;
  }

  public classCount(): number {
    return this.rootClasses().length;
  }

  public nodeCount(): number {
    return this.rootClasses().reduce((sum, eClass) => sum + eClass.nodes.length, 0);
  }

  private addNode(rawNode: ENode): number {
    const node = this.canonicalNode(rawNode);
    for (const eClass of this.rootClasses())
      if (eClass.nodes.some((candidate) => sameNode(candidate, node))) return eClass.id;
    const id = this.unionFind.makeSet();
    this.classes.set(id, { id, nodes: [node] });
    return id;
  }

  private compactClasses(): void {
    const compact = new Map<number, EClass>();
    for (const [id, eClass] of this.classes) {
      const root = this.unionFind.find(id);
      const target = compact.get(root) ?? { id: root, nodes: [] };
      for (const rawNode of eClass.nodes) {
        const node = this.canonicalNode(rawNode);
        if (!target.nodes.some((candidate) => sameNode(candidate, node))) target.nodes.push(node);
      }
      compact.set(root, target);
    }
    this.classes.clear();
    for (const [id, eClass] of compact) this.classes.set(id, eClass);
  }

  private canonicalNode(node: ENode): ENode {
    return node.kind === "application"
      ? {
          kind: "application",
          children: node.children.map((child) => this.unionFind.find(child)),
        }
      : node;
  }

  private rootClasses(): EClass[] {
    return [...this.classes.values()].filter(
      (eClass) => this.unionFind.find(eClass.id) === eClass.id,
    );
  }
}

function contextHash(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalResult(atom: Atom): string {
  return format(canonicalize(atom, new Map()));
}

function sameResults(left: readonly Atom[], right: readonly Atom[]): boolean {
  return (
    left.length === right.length && left.every((atom, index) => alphaEq(atom, right[index] as Atom))
  );
}

function definitionHead(node: SpannedNode): string | null {
  if (node.atom.kind !== "expr" || node.atom.items[0]?.kind !== "sym") return null;
  if (node.atom.items[0].name !== "=") return null;
  const pattern = node.atom.items[1];
  const head = pattern?.kind === "expr" ? pattern.items[0] : pattern;
  return head?.kind === "sym" ? head.name : null;
}

function evaluationContext(source: string, fuel: number): EvaluationContext {
  const parsed = parseCst(source, TOKENIZER);
  const atoms = parsed.nodes.filter((node) => node.bang !== true).map((node) => node.atom);
  const env = buildEnv(atoms, GROUNDINGS);
  return {
    source,
    fuel,
    pureFunctions: analyzePurity(env, SIMPLIFIER_IMPURE_OPS),
    definedFunctions: new Set(parsed.nodes.flatMap((node) => definitionHead(node) ?? [])),
    openWorld: parsed.nodes.some((node) => node.bang === true),
  };
}

function safeHead(name: string, context: EvaluationContext): boolean {
  if (SIMPLIFIER_IMPURE_OPS.has(name)) return false;
  if (context.definedFunctions.has(name)) return context.pureFunctions.has(name);
  if (PURE_SPECIAL_FORMS.has(name)) return true;
  const grounding = GROUNDINGS.get(name);
  if (grounding !== undefined) return isTableSafeGroundedOp(name, grounding);
  // With no executable import in the context, an unknown head is an inert data constructor. Once an import
  // can add definitions, its behavior is open-world and must be treated as unknown instead.
  return !context.openWorld;
}

function safeToReduce(atom: Atom, context: EvaluationContext): boolean {
  if (atom.kind !== "expr") return true;
  const head = atom.items[0];
  if (head?.kind !== "sym" || !safeHead(head.name, context)) return false;
  if (head.name === "if" && atom.items.length === 4) {
    const condition = atom.items[1];
    if (condition?.kind === "gnd" && condition.value.g === "bool" && condition.value.b)
      return safeToReduce(condition, context) && safeToReduce(atom.items[2] as Atom, context);
    if (condition?.kind === "gnd" && condition.value.g === "bool" && !condition.value.b)
      return safeToReduce(condition, context) && safeToReduce(atom.items[3] as Atom, context);
  }
  return atom.items.slice(1).every((item) => safeToReduce(item, context));
}

function evaluateAtom(atom: Atom, context: EvaluationContext): readonly Atom[] | null {
  if (!safeToReduce(atom, context)) return null;
  try {
    // A bang immediately fused to a leaf (`!42`, `!foo`) is a symbol in MeTTa, not a query. The space keeps
    // every atom kind on the query path while preserving the atom itself.
    const query = `! ${format(atom)}`;
    const source = context.source.trim().length === 0 ? query : `${context.source}\n${query}`;
    return runProgram(source, context.fuel, new Map(), { tabling: true }).at(-1)?.results ?? [];
  } catch {
    return null;
  }
}

function expressionFromSource(source: string): Atom | null {
  const parsed = parseCst(source, TOKENIZER);
  return parsed.diagnostics.length === 0 && parsed.nodes.length === 1
    ? (parsed.nodes[0]?.atom ?? null)
    : null;
}

function defaultContext(source: string): string {
  const parsed = parseCst(source, TOKENIZER);
  return parsed.nodes
    .filter((node) => node.bang !== true)
    .map((node) => source.slice(node.span.start, node.span.end))
    .join("\n");
}

export function verifySimplificationProof(
  proof: SimplificationProof,
  context = "",
  fuel = 20_000,
): boolean {
  if (proof.contextHash !== contextHash(context)) return false;
  const original = expressionFromSource(proof.original);
  const simplified = expressionFromSource(proof.simplified);
  if (original === null || simplified === null) return false;
  const runtime = evaluationContext(context, fuel);
  const originalResults = evaluateAtom(original, runtime);
  const simplifiedResults = evaluateAtom(simplified, runtime);
  if (
    originalResults === null ||
    simplifiedResults === null ||
    !sameResults(originalResults, simplifiedResults)
  )
    return false;
  if (
    originalResults.map(canonicalResult).join("\n") !== proof.originalResults.join("\n") ||
    simplifiedResults.map(canonicalResult).join("\n") !== proof.simplifiedResults.join("\n")
  )
    return false;
  for (const step of proof.steps) {
    const before = expressionFromSource(step.before);
    const after = expressionFromSource(step.after);
    if (before === null || after === null) return false;
    const results = evaluateAtom(before, runtime);
    if (
      results === null ||
      results.map(canonicalResult).join("\n") !== step.results.join("\n") ||
      results.length !== 1 ||
      !alphaEq(results[0] as Atom, after)
    )
      return false;
  }
  return true;
}

export function simplifyExpression(
  source: string,
  options: Omit<SimplifyOptions, "range"> = {},
): Simplification | null {
  const original = expressionFromSource(source);
  if (original === null || original.kind !== "expr") return null;
  const contextSource = options.context ?? "";
  const context = evaluationContext(contextSource, Math.max(1, options.fuel ?? 20_000));
  if (!safeToReduce(original, context)) return null;
  const graph = new AtomEGraph();
  const root = graph.addAtom(original);
  const maxIterations = Math.max(1, options.maxIterations ?? 8);
  const maxNodes = Math.max(atomSize(original), options.maxNodes ?? 1_000);
  let iterations = 0;

  for (; iterations < maxIterations && graph.nodeCount() < maxNodes; iterations++) {
    let changed = false;
    for (const eClass of graph.entries()) {
      const candidate = graph.extract(eClass.id);
      if (candidate?.kind !== "expr") continue;
      const results = evaluateAtom(candidate, context);
      if (results?.length !== 1) continue;
      const reduced = results[0] as Atom;
      if (alphaEq(candidate, reduced)) continue;
      if (atomSize(reduced) > Math.max(atomSize(candidate) * 2, atomSize(original) * 2)) continue;
      if (graph.addReduction(candidate, reduced, results)) changed = true;
      if (graph.nodeCount() >= maxNodes) break;
    }
    if (graph.rebuild()) changed = true;
    if (!changed) {
      iterations += 1;
      break;
    }
  }

  const simplified = graph.extract(root);
  if (simplified === null || alphaEq(original, simplified) || !lowerCost(simplified, original))
    return null;
  const originalResults = evaluateAtom(original, context);
  const simplifiedResults = evaluateAtom(simplified, context);
  if (
    originalResults === null ||
    simplifiedResults === null ||
    !sameResults(originalResults, simplifiedResults)
  )
    return null;
  const proof: SimplificationProof = {
    strategy: "equality-saturation",
    contextHash: contextHash(contextSource),
    original: format(original),
    simplified: format(simplified),
    originalResults: originalResults.map(canonicalResult),
    simplifiedResults: simplifiedResults.map(canonicalResult),
    steps: graph.reductionSteps().map((step) => ({
      rule: "metta.reduce",
      before: format(step.before),
      after: format(step.after),
      results: step.results.map(canonicalResult),
    })),
    iterations,
    eClasses: graph.classCount(),
    eNodes: graph.nodeCount(),
    verified: true,
  };
  if (!verifySimplificationProof(proof, contextSource, context.fuel)) return null;
  return { before: source, after: format(simplified), proof };
}

function executableRoots(parsed: ReturnType<typeof parseCst>): SpannedNode[] {
  const roots: SpannedNode[] = [];
  for (const top of parsed.nodes) {
    if (top.bang === true) {
      roots.push(top);
      continue;
    }
    const children = top.children ?? [];
    const head = children[0]?.atom;
    const name = head?.kind === "sym" ? head.name : "";
    if ((name === "=" || name === "macro" || name === "defmacro") && children[2] !== undefined)
      roots.push(children[2]);
  }
  return roots;
}

function executableChildren(node: SpannedNode): readonly SpannedNode[] {
  const children = node.children ?? [];
  const head = children[0]?.atom;
  const name = head?.kind === "sym" ? head.name : "";
  if (name === "quote") return [];
  if (name === "match")
    return [children[1], children[3]].filter((child): child is SpannedNode => child !== undefined);
  if (name === "case") {
    const branches = children[2]?.children ?? [];
    return [children[1], ...branches.flatMap((branch) => (branch.children ?? []).slice(1))].filter(
      (child): child is SpannedNode => child !== undefined,
    );
  }
  if (name === "let")
    return [children[2], children[3]].filter((child): child is SpannedNode => child !== undefined);
  if (name === "let*") {
    const bindings = children[1]?.children ?? [];
    return [
      ...bindings.flatMap((binding) => (binding.children ?? []).slice(1)),
      children[2],
    ].filter((child): child is SpannedNode => child !== undefined);
  }
  return children;
}

function blockedChildren(node: SpannedNode): readonly SpannedNode[] {
  const children = node.children ?? [];
  const head = children[0]?.atom;
  const name = head?.kind === "sym" ? head.name : "";
  if (name === "quote") return children.slice(1);
  if (name === "match") return children[2] ? [children[2]] : [];
  if (name === "case")
    return (children[2]?.children ?? []).flatMap((branch) => branch.children?.[0] ?? []);
  if (name === "let") return children[1] ? [children[1]] : [];
  if (name === "let*")
    return (children[1]?.children ?? []).flatMap((binding) => binding.children?.[0] ?? []);
  return [];
}

function selectedNode(
  root: SpannedNode,
  range: { readonly start: number; readonly end: number },
): SpannedNode | null {
  if (root.span.start > range.start || root.span.end < range.end) return null;
  const visit = (node: SpannedNode): SpannedNode | null => {
    if (
      blockedChildren(node).some(
        (child) => child.span.start <= range.start && child.span.end >= range.end,
      )
    )
      return null;
    for (const child of executableChildren(node)) {
      if (child.kind === "expr" && child.span.start <= range.start && child.span.end >= range.end)
        return visit(child);
    }
    return node;
  };
  return visit(root);
}

export function simplifyDocument(
  source: string,
  options: SimplifyOptions = {},
): SimplifyDocumentResult {
  const parsed = parseCst(source, TOKENIZER);
  if (parsed.diagnostics.length > 0)
    return {
      complete: false,
      text: source,
      edits: [],
      issues: parsed.diagnostics.map((diagnostic) => ({
        code: "parse-error",
        message: diagnostic.message,
        start: diagnostic.span.start,
        end: diagnostic.span.end,
      })),
    };
  const roots = executableRoots(parsed);
  const targets =
    options.range === undefined
      ? roots
      : roots.flatMap((root) => {
          const selected = selectedNode(root, options.range as { start: number; end: number });
          return selected === null ? [] : [selected];
        });
  if (options.range !== undefined && targets.length === 0)
    return {
      complete: false,
      text: source,
      edits: [],
      issues: [
        {
          code: "invalid-selection",
          message: "The selection is not inside an executable MeTTa expression.",
          start: options.range.start,
          end: options.range.end,
        },
      ],
    };
  const context = options.context ?? defaultContext(source);
  const edits = targets.flatMap((target): SimplificationEdit[] => {
    const before = source.slice(target.span.start, target.span.end);
    const result = simplifyExpression(before, { ...options, context });
    return result === null ? [] : [{ ...result, start: target.span.start, end: target.span.end }];
  });
  edits.sort((left, right) => right.start - left.start);
  let text = source;
  let boundary = Number.POSITIVE_INFINITY;
  const applied: SimplificationEdit[] = [];
  for (const edit of edits) {
    if (edit.end > boundary) continue;
    text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
    boundary = edit.start;
    applied.push(edit);
  }
  return { complete: true, text, edits: applied.reverse(), issues: [] };
}
