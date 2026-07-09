// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The interpreter's own builtin type catalog, read from core's prelude + stdlib `(: name type)` atoms. This
// is the ground truth the hand-maintained builtins.ts is checked against, so the static catalog's arities
// can never silently drift from the running system (the differential test). Pure: only @metta-ts/core.

import { type Atom, format, preludeAtoms, stdlibAtoms } from "@metta-ts/core";

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

// name -> declared type, from core's own atoms. The first declaration of a name wins (prelude before stdlib).
export function coreBuiltinTypes(): ReadonlyMap<string, CoreBuiltinType> {
  const catalog = new Map<string, CoreBuiltinType>();
  for (const atom of [...preludeAtoms(), ...stdlibAtoms()]) {
    if (atom.kind !== "expr") continue;
    const head = atom.items[0];
    const nameAtom = atom.items[1];
    const typeAtom = atom.items[2];
    if (head === undefined || head.kind !== "sym" || head.name !== ":") continue;
    if (nameAtom === undefined || nameAtom.kind !== "sym") continue;
    if (typeAtom === undefined) continue;
    if (catalog.has(nameAtom.name)) continue;
    catalog.set(nameAtom.name, {
      name: nameAtom.name,
      type: format(typeAtom),
      arity: arityOfType(typeAtom),
    });
  }
  return catalog;
}
