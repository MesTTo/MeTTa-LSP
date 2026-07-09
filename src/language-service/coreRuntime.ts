// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Live introspection backed by @metta-ts/core (§2.9 RuntimeProvider, §9 "wire live get-type/get-doc"). Every
// answer runs the real interpreter over an assembled context (the visible declarations) plus the query, so
// the LSP's types and docs are interpreter-exact by construction rather than a hand-maintained catalog that
// can drift. `runProgram` is a pure function of its source (no node builtins), so this compiles for node, the
// browser worker, and tests alike; the fuel cap keeps get-type/get-doc bounded. Interactive evaluation of
// arbitrary user code still belongs behind the hard-kill guarded worker; this path is for introspection.

import { type Atom, DEFAULT_FUEL, format, runProgram } from "@metta-ts/core";
import { err, ok, type Result } from "neverthrow";

export type RuntimeError =
  | { readonly kind: "runtimeError"; readonly message: string }
  | { readonly kind: "fuelExhausted" };

// A parsed `@doc-formal` record (the shape core's get-doc produces), ready for hover rendering.
export interface MettaDoc {
  readonly item: string;
  readonly kind: string;
  readonly type: string;
  readonly description: string;
  readonly params: readonly MettaDocParam[];
  readonly return: MettaDocParam | null;
}
export interface MettaDocParam {
  readonly type: string;
  readonly description: string;
}

// The fuel cap for introspection queries. get-type/get-doc are bounded, so this only guards a pathological
// context; a program that hits the cap yields no definitive answer (reported as fuelExhausted upstream is
// unnecessary here since get-type does not evaluate, but evaluate() may reach it).
const INTROSPECTION_FUEL = DEFAULT_FUEL;

function headName(atom: Atom): string {
  if (atom.kind !== "expr") return "";
  const head = atom.items[0];
  return head?.kind === "sym" ? head.name : "";
}

function stringValue(atom: Atom | undefined): string {
  if (atom?.kind === "gnd" && atom.value.g === "str") return atom.value.s;
  return atom ? format(atom) : "";
}

// The single argument of a one-argument wrapper like (@type T) or (@item X).
function argOf(atom: Atom | undefined, wrapper: string): Atom | undefined {
  if (atom?.kind === "expr" && headName(atom) === wrapper) return atom.items[1];
  return undefined;
}

function parseParam(atom: Atom): MettaDocParam {
  if (atom.kind !== "expr") return { type: "", description: format(atom) };
  const typeAtom = argOf(atom.items[1], "@type");
  const descAtom = argOf(atom.items[2], "@desc");
  return {
    type: typeAtom ? format(typeAtom) : "",
    description: stringValue(descAtom),
  };
}

// Walk a get-doc result into a MettaDoc, or null when there is no documentation (Empty / no @doc-formal).
function parseDoc(atoms: readonly Atom[]): MettaDoc | null {
  const doc = atoms.find((atom) => headName(atom) === "@doc-formal");
  if (doc === undefined || doc.kind !== "expr") return null;

  let item = "";
  let kind = "";
  let type = "";
  let description = "";
  const params: MettaDocParam[] = [];
  let returnDoc: MettaDocParam | null = null;

  for (const child of doc.items.slice(1)) {
    switch (headName(child)) {
      case "@item":
        item = child.kind === "expr" ? stringValue(child.items[1]) : "";
        break;
      case "@kind":
        kind = child.kind === "expr" ? stringValue(child.items[1]) : "";
        break;
      case "@type":
        type = child.kind === "expr" && child.items[1] ? format(child.items[1]) : "";
        break;
      case "@desc":
        description = child.kind === "expr" ? stringValue(child.items[1]) : "";
        break;
      case "@params":
        if (child.kind === "expr" && child.items[1]?.kind === "expr") {
          for (const param of child.items[1].items) params.push(parseParam(param));
        }
        break;
      case "@return":
        returnDoc = parseParam(child);
        break;
      default:
        break;
    }
  }
  return { item, kind, type, description, params, return: returnDoc };
}

export class CoreRuntime {
  // Run the bang query `!<query>` after `context` (declaration source only, never bang queries) and return
  // the result atoms of that final query. `query` is a full parenthesized expression. Core exceptions
  // become a runtimeError.
  private queryAtoms(
    context: string,
    query: string,
    tabling = false,
  ): Result<readonly Atom[], RuntimeError> {
    const source = context.length > 0 ? `${context}\n!${query}` : `!${query}`;
    try {
      // Tabling is off for introspection (get-type/get-doc/check-types): they never evaluate a body, so the
      // purity analysis it sets up (analyzePurity) is pure overhead — on a large file it dominated the whole
      // check-types batch (~30x). `evaluate` opts back in for its body reduction.
      const results = runProgram(source, INTROSPECTION_FUEL, new Map(), { tabling });
      const last = results.at(-1);
      return ok(last ? last.results : []);
    } catch (error) {
      return err({
        kind: "runtimeError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The type(s) of `expression` under `context`. An empty array means the expression has no valid type (it
  // is ill-typed) — core's own get-type answer.
  public getType(context: string, expression: string): Result<readonly string[], RuntimeError> {
    return this.queryAtoms(context, `(get-type ${expression})`).map((atoms) => atoms.map(format));
  }

  // The documentation for `symbol` under `context`, or null when it has none.
  public getDoc(context: string, symbol: string): Result<MettaDoc | null, RuntimeError> {
    return this.queryAtoms(context, `(get-doc ${symbol})`).map(parseDoc);
  }

  // Evaluate `expression` under `context`, returning the result atoms as source. Fuel-bounded, not the
  // hard-kill guarded path; callers that run untrusted code interactively use the guarded worker instead.
  public evaluate(context: string, expression: string): Result<readonly string[], RuntimeError> {
    // Evaluate runs the body, so it opts into tabling to complete recursive forms within the fuel bound.
    return this.queryAtoms(context, expression, true).map((atoms) => atoms.map(format));
  }

  // Run the interpreter's own applicability check on `expression` (the grounded op `check-types`, added to
  // core for the LSP): it returns the Error atom the evaluator would produce for a wrong-arity or wrong-type
  // call — `(Error <call> IncorrectNumberOfArguments)` or `(Error <call> (BadArgType idx expected actual))` —
  // WITHOUT evaluating the body (no side effects), or the unit `()` when the call is well-typed / untyped.
  // Parsed structurally so the diagnostic carries the interpreter's exact detail, like a real compiler error.
  public checkTypes(
    context: string,
    expression: string,
  ): Result<TypeCheckError | null, RuntimeError> {
    return this.queryAtoms(context, `(check-types ${expression})`).map((atoms) =>
      parseCheckTypesResult(atoms[0]),
    );
  }

  // Batched check-types: one interpreter run over `context` plus a `!(check-types e)` query per expression, so
  // the declaration context is parsed and built once, not once per call. Returns a verdict per input, in the
  // same order. This keeps an editor validate O(context + calls) instead of O(context × calls).
  public checkTypesBatch(
    context: string,
    expressions: readonly string[],
  ): Result<readonly (TypeCheckError | null)[], RuntimeError> {
    if (expressions.length === 0) return ok([]);
    const queries = expressions.map((expression) => `!(check-types ${expression})`).join("\n");
    const source = context.length > 0 ? `${context}\n${queries}` : queries;
    try {
      // No tabling: check-types never evaluates a body, so its purity analysis is pure overhead (queryAtoms).
      const results = runProgram(source, INTROSPECTION_FUEL, new Map(), { tabling: false });
      const tail = results.slice(-expressions.length);
      return ok(tail.map((form) => parseCheckTypesResult(form.results[0])));
    } catch (error) {
      return err({
        kind: "runtimeError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// The interpreter's verdict for a single application: an arity mismatch, a wrong-typed argument (which one,
// what was expected, what it got), or a return-type cast failure. Mirrors Hyperon's IncorrectNumberOfArguments
// / BadArgType / BadType error descriptions.
export type TypeCheckError =
  | { readonly kind: "arity"; readonly call: string }
  | {
      readonly kind: "badArg";
      readonly call: string;
      readonly index: number;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly kind: "badType";
      readonly call: string;
      readonly expected: string;
      readonly actual: string;
    };

// Parse the atom `(check-types …)` reduces to. The unit `()` (or no result) means well-typed → null.
function parseCheckTypesResult(result: Atom | undefined): TypeCheckError | null {
  if (result === undefined) return null;
  if (result.kind !== "expr") return null;
  if (result.items.length === 0) return null; // the unit () — well-typed
  if (result.items.length !== 3) return null;
  const [head, call, desc] = result.items;
  if (head?.kind !== "sym" || head.name !== "Error" || call === undefined || desc === undefined)
    return null;
  const callSrc = format(call);
  if (desc.kind === "sym" && desc.name === "IncorrectNumberOfArguments")
    return { kind: "arity", call: callSrc };
  if (desc.kind === "expr" && desc.items[0]?.kind === "sym") {
    const tag = desc.items[0].name;
    if (tag === "BadArgType" && desc.items.length === 4)
      return {
        kind: "badArg",
        call: callSrc,
        index: Number(format(desc.items[1] as Atom)),
        expected: format(desc.items[2] as Atom),
        actual: format(desc.items[3] as Atom),
      };
    if (tag === "BadType" && desc.items.length === 3)
      return {
        kind: "badType",
        call: callSrc,
        expected: format(desc.items[1] as Atom),
        actual: format(desc.items[2] as Atom),
      };
  }
  return null;
}
