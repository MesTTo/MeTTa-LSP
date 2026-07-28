// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The built-in modules @metta-ts/core exposes via `(import! &self <name>)`. @metta-ts/libraries registers
// the pure MeTTa standard-library modules as a side effect before `builtinModules()` is read.
// A file that imports one of these should see its declared symbols as known (not "undefined function"),
// resolve the import, and get the symbols' interpreter types and docs. The names and their declared symbols
// are read from core's own `builtinModules()`, so this stays in lockstep with the interpreter instead of
// being a second hand-maintained list.

import "@metta-ts/libraries";
import type { Atom } from "@metta-ts/core";
import { builtinModuleSymbolMap } from "../language-service/index.js";

const MODULE_SYMBOLS: ReadonlyMap<string, ReadonlySet<string>> = new Map(builtinModuleSymbolMap());

// The names importable as built-in modules via `(import! &self <name>)`.
export const BUILTIN_MODULE_NAMES: ReadonlySet<string> = new Set(MODULE_SYMBOLS.keys());

// The symbols a built-in module declares, or an empty set for a name that is not a built-in module.
export function builtinModuleSymbols(name: string): ReadonlySet<string> {
  return MODULE_SYMBOLS.get(name) ?? new Set();
}

// The built-in module that declares `symbol`, or undefined if no module does. Lets the analyzer turn an
// unknown head that is exactly a module export (e.g. json-encode with no import) into a precise "import this
// module" hint rather than a fuzzy guess.
export function moduleExportingSymbol(symbol: string): string | undefined {
  for (const [module, symbols] of MODULE_SYMBOLS) if (symbols.has(symbol)) return module;
  return undefined;
}

// An `(import! <space> <module>)` atom whose module is a built-in one. Executing it in the introspection
// context loads that module's declarations, so get-type/get-doc see the module's symbols.
export function isBuiltinModuleImport(atom: Atom): boolean {
  if (atom.kind !== "expr" || atom.items.length < 2) return false;
  const head = atom.items[0];
  const module = atom.items[atom.items.length - 1];
  return (
    head?.kind === "sym" &&
    head.name === "import!" &&
    module?.kind === "sym" &&
    BUILTIN_MODULE_NAMES.has(module.name)
  );
}
