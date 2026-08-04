// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { type Atom, builtinModules, type ImportEntry } from "@metta-ts/core";

// A builtin module is registered either as a bare list of atoms or, since a module can declare what it
// imports, as a record carrying those atoms in `defs`. Both mean the same thing to a catalog: the
// declarations the module introduces.
export function moduleDefinitions(entry: ImportEntry): readonly Atom[] {
  return Array.isArray(entry) ? entry : entry.defs;
}

// The head a module declaration introduces: `(: name ...)` becomes name, as does the left side of `=`.
function declaredHead(atom: Atom): string | undefined {
  if (atom.kind !== "expr" || atom.items.length < 2) return undefined;
  const head = atom.items[0];
  const lhs = atom.items[1];
  if (head?.kind !== "sym") return undefined;
  if (head.name === ":") return lhs?.kind === "sym" ? lhs.name : undefined;
  if (head.name !== "=") return undefined;
  if (lhs?.kind === "sym") return lhs.name;
  return lhs?.kind === "expr" && lhs.items[0]?.kind === "sym" ? lhs.items[0].name : undefined;
}

// Read the current registry on each call. Hosts may register more builtin modules before requesting a catalog.
export function builtinModuleSymbolMap(): ReadonlyMap<string, ReadonlySet<string>> {
  return new Map(
    [...builtinModules()].map(([name, entry]) => [
      name,
      new Set(
        moduleDefinitions(entry)
          .map(declaredHead)
          .filter((symbol): symbol is string => symbol !== undefined),
      ),
    ]),
  );
}

export function builtinModuleExportNames(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const symbols of builtinModuleSymbolMap().values())
    for (const symbol of symbols) names.add(symbol);
  return names;
}
