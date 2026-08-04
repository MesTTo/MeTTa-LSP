// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The interpreter's own builtin type catalog, read from core's source declarations and grounded-operation
// metadata. This matches the evaluator without exposing intrinsic types as ordinary &self data. Pure: only
// @metta-ts/core.

import {
  type Atom,
  emptyEnv,
  format,
  pettaStdlibAtoms,
  preludeAtoms,
  stdlibAtoms,
  stdlibDocAtoms,
  stdTable,
} from "@metta-ts/core";

export interface CoreBuiltinType {
  readonly name: string;
  // The type signature source, e.g. "(-> Number Number Number)".
  readonly type: string;
  // The fixed call arity of a function type; null for a non-arrow (constant / type) declaration.
  readonly arity: number | null;
}

// The fixed argument count of a function type (-> A B ... R): the item count minus the `->` head and the
// return type. A non-arrow type declaration has no call arity.
function arityOfType(typeAtom: Atom): number | null {
  if (typeAtom.kind !== "expr") return null;
  const head = typeAtom.items[0];
  if (head === undefined || head.kind !== "sym" || head.name !== "->") return null;
  return Math.max(0, typeAtom.items.length - 2);
}

function addType(catalog: Map<string, CoreBuiltinType>, name: string, typeAtom: Atom): void {
  if (catalog.has(name)) return;
  catalog.set(name, {
    name,
    type: format(typeAtom),
    arity: arityOfType(typeAtom),
  });
}

// Name -> declared type. Source declarations retain prelude/stdlib order and precedence. Operation-owned
// types are appended from the same metadata the evaluator loads.
//
// All three source modules are read, not two. The runner loads prelude, stdlib AND the PeTTa-compat stdlib
// into every program, so leaving the third out hid everything declared there: the lambda `|->`, foldall,
// maplist, foldl, forall, cons, find, match-count, iterate, progn, prog1, reduce and all-true. They were
// callable but had no declared type here, which cost more than hover text — VARIABLE_ARG_POSITIONS is
// derived from this map, so a Variable-typed slot in one of them was never linted either.
export function coreBuiltinTypes(): ReadonlyMap<string, CoreBuiltinType> {
  const catalog = new Map<string, CoreBuiltinType>();
  const atoms = [...preludeAtoms(), ...stdlibAtoms(), ...pettaStdlibAtoms()];
  for (const atom of atoms) {
    if (atom.kind !== "expr") continue;
    const head = atom.items[0];
    const nameAtom = atom.items[1];
    const typeAtom = atom.items[2];
    if (head === undefined || head.kind !== "sym" || head.name !== ":") continue;
    if (nameAtom === undefined || nameAtom.kind !== "sym") continue;
    if (typeAtom === undefined) continue;
    addType(catalog, nameAtom.name, typeAtom);
  }
  for (const [name, typeAtoms] of emptyEnv(stdTable()).types) {
    for (const typeAtom of typeAtoms) addType(catalog, name, typeAtom);
  }
  return catalog;
}

// Every name the standard library documents. A type catalog can only see what carries a `(: name <type>)`
// declaration, and a MeTTa function defined with `=` alone carries none — `progn`, `prog1`, `iterate`,
// `find`, `match-count`, `cons` and `reduce` are all defined that way, so nothing here knew they existed
// even though every program can call them.
//
// Documentation is the source that does know. Since MeTTaScript 3.1.2 documents every operation it offers,
// `@doc` is the interpreter's own statement of its public surface, and it is the right one to read: the
// stdlib helpers it leaves undocumented are the ones a caller has no business writing.
export function documentedBuiltinNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const atom of stdlibDocAtoms()) {
    if (atom.kind !== "expr" || atom.items.length < 2) continue;
    const head = atom.items[0];
    const subject = atom.items[1];
    if (head === undefined || head.kind !== "sym" || head.name !== "@doc") continue;
    if (subject !== undefined && subject.kind === "sym") names.add(subject.name);
  }
  return names;
}
