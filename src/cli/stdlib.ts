// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Read-only standard-library discovery for the CLI. Global entries come from the same catalog that powers
// LSP hover and completion. @metta-ts/libraries registers pure MeTTa modules before the import-gated entries
// are read from core's builtinModules(), and all structured docs come from the same interpreter get-doc
// adapter used by hover and generated reference pages.

import "@metta-ts/libraries";
import { type Atom, builtinModules, FuzzyMatcher, format } from "@metta-ts/core";
import { CoreRuntime, type MettaDoc, type MettaDocParam } from "../language-service/index.js";
import { builtinModuleSymbols } from "../server/builtinModules.js";
import {
  allBuiltinDefinitions,
  BUILTIN_BY_NAME,
  PROLOG_OP_NAMES,
  PY_OP_NAMES,
} from "../server/builtins.js";
import type { DefinitionKind, DefinitionRecord } from "../server/types.js";

export type StdlibCategory = "core" | "lsp-extension" | "host-extension";

export interface StdlibEntry {
  readonly type: "entry";
  readonly name: string;
  readonly qualifiedName: string;
  readonly scope: "global" | "module";
  readonly category: StdlibCategory;
  readonly module: string | null;
  readonly kind: DefinitionKind;
  readonly signatures: readonly string[];
  readonly description: string;
  readonly parameters: readonly MettaDocParam[];
  readonly returns: MettaDocParam | null;
  readonly documented: boolean;
  readonly deprecated: boolean;
  readonly source: string;
}

export interface StdlibModule {
  readonly type: "module";
  readonly name: string;
  readonly importForm: string;
  readonly exports: readonly string[];
}

export interface StdlibCatalog {
  readonly collection: "stdlib";
  readonly counts: {
    readonly entries: number;
    readonly globalEntries: number;
    readonly coreGlobalEntries: number;
    readonly lspExtensionEntries: number;
    readonly hostExtensionEntries: number;
    readonly moduleEntries: number;
    readonly modules: number;
    readonly documentedEntries: number;
  };
  readonly modules: readonly StdlibModule[];
  readonly entries: readonly StdlibEntry[];
}

export interface StdlibLookupError {
  readonly code: "stdlib.unknown" | "stdlib.ambiguous";
  readonly query: string;
  readonly message: string;
  readonly candidates: readonly string[];
  readonly suggestions: readonly string[];
}

export type StdlibLookupResult =
  | { readonly ok: true; readonly value: StdlibEntry | StdlibModule }
  | { readonly ok: false; readonly error: StdlibLookupError };

const KIND_ORDER: readonly DefinitionKind[] = [
  "macro",
  "type",
  "function",
  "constant",
  "keyword",
  "space",
  "binding",
  "module",
  "unknown",
];

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function runtimeDoc(runtime: CoreRuntime, context: string, name: string): MettaDoc | null {
  const result = runtime.getDoc(context, name);
  return result.isOk() ? result.value : null;
}

function isDocumented(doc: MettaDoc | null, description: string): boolean {
  return (
    description.length > 0 ||
    doc?.params.some((param) => param.description.length > 0) === true ||
    (doc?.return?.description.length ?? 0) > 0
  );
}

function globalSignatures(def: DefinitionRecord): string[] {
  const catalog = BUILTIN_BY_NAME.get(def.name);
  if (catalog !== undefined && catalog.signatures.length > 0) return unique(catalog.signatures);
  if (def.signature !== undefined) return [def.signature.raw];
  if (def.kind === "type") return ["Type"];
  return [];
}

function globalCategory(def: DefinitionRecord): StdlibCategory {
  if (PY_OP_NAMES.has(def.name) || PROLOG_OP_NAMES.has(def.name)) return "host-extension";
  if (def.source === "MeTTa LSP import alias") return "lsp-extension";
  return "core";
}

function globalEntry(runtime: CoreRuntime, def: DefinitionRecord): StdlibEntry {
  const doc = runtimeDoc(runtime, "", def.name);
  const description = doc?.description || def.documentation || "";
  return {
    type: "entry",
    name: def.name,
    qualifiedName: `global::${def.name}`,
    scope: "global",
    category: globalCategory(def),
    module: null,
    kind: def.kind,
    signatures: globalSignatures(def),
    description,
    parameters: doc?.params ?? [],
    returns: doc?.return ?? null,
    documented: isDocumented(doc, description),
    deprecated: def.deprecated === true,
    source: def.source ?? "@metta-ts/core",
  };
}

function declaredModuleTypes(atoms: readonly Atom[]): ReadonlyMap<string, readonly string[]> {
  const types = new Map<string, string[]>();
  for (const atom of atoms) {
    if (atom.kind !== "expr") continue;
    const head = atom.items[0];
    const name = atom.items[1];
    const type = atom.items[2];
    if (head?.kind !== "sym" || head.name !== ":" || name?.kind !== "sym" || type === undefined)
      continue;
    const signatures = types.get(name.name) ?? [];
    signatures.push(format(type));
    types.set(name.name, signatures);
  }
  return types;
}

function moduleKind(name: string, signatures: readonly string[]): DefinitionKind {
  return signatures.includes("Type") || (signatures.length === 0 && /^[A-Z]/u.test(name))
    ? "type"
    : "function";
}

function moduleEntries(runtime: CoreRuntime): {
  readonly entries: StdlibEntry[];
  readonly modules: StdlibModule[];
} {
  const entries: StdlibEntry[] = [];
  const modules: StdlibModule[] = [];
  const coreModules = [...builtinModules()].sort(([left], [right]) => left.localeCompare(right));
  for (const [module, atoms] of coreModules) {
    const context = atoms.map(format).join("\n");
    const declarations = declaredModuleTypes(atoms);
    const exportNames = [...builtinModuleSymbols(module)].sort((left, right) =>
      left.localeCompare(right),
    );
    const qualifiedExports: string[] = [];
    for (const name of exportNames) {
      const declaredSignatures = declarations.get(name) ?? [];
      const typeResult = declaredSignatures.length > 0 ? runtime.getType(context, name) : undefined;
      const signatures = unique(
        typeResult?.isOk() === true ? typeResult.value : declaredSignatures,
      );
      const doc = runtimeDoc(runtime, context, name);
      const description = doc?.description ?? "";
      const qualifiedName = `${module}::${name}`;
      qualifiedExports.push(qualifiedName);
      entries.push({
        type: "entry",
        name,
        qualifiedName,
        scope: "module",
        category: "core",
        module,
        kind: moduleKind(name, signatures),
        signatures,
        description,
        parameters: doc?.params ?? [],
        returns: doc?.return ?? null,
        documented: isDocumented(doc, description),
        deprecated: false,
        source: `@metta-ts/core builtin module ${module}`,
      });
    }
    modules.push({
      type: "module",
      name: module,
      importForm: `!(import! &self ${module})`,
      exports: qualifiedExports,
    });
  }
  return { entries, modules };
}

function compareEntries(left: StdlibEntry, right: StdlibEntry): number {
  if (left.scope !== right.scope) return left.scope === "global" ? -1 : 1;
  const byModule = (left.module ?? "").localeCompare(right.module ?? "");
  if (byModule !== 0) return byModule;
  const byKind = KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
  if (byKind !== 0) return byKind;
  return left.name.localeCompare(right.name);
}

export function buildStdlibCatalog(runtime = new CoreRuntime()): StdlibCatalog {
  const globals = allBuiltinDefinitions().map((def) => globalEntry(runtime, def));
  const imported = moduleEntries(runtime);
  const entries = [...globals, ...imported.entries].sort(compareEntries);
  const countGlobalCategory = (category: StdlibCategory): number =>
    globals.filter((entry) => entry.category === category).length;
  return {
    collection: "stdlib",
    counts: {
      entries: entries.length,
      globalEntries: globals.length,
      coreGlobalEntries: countGlobalCategory("core"),
      lspExtensionEntries: countGlobalCategory("lsp-extension"),
      hostExtensionEntries: countGlobalCategory("host-extension"),
      moduleEntries: imported.entries.length,
      modules: imported.modules.length,
      documentedEntries: entries.filter((entry) => entry.documented).length,
    },
    modules: imported.modules,
    entries,
  };
}

let catalogCache: StdlibCatalog | undefined;

export function stdlibCatalog(): StdlibCatalog {
  catalogCache ??= buildStdlibCatalog();
  return catalogCache;
}

function suggestionsFor(catalog: StdlibCatalog, query: string): string[] {
  const terms = new Set<string>();
  for (const module of catalog.modules) terms.add(module.name);
  for (const entry of catalog.entries) {
    terms.add(entry.name);
    terms.add(entry.qualifiedName);
  }
  return new FuzzyMatcher(terms).suggest(query).slice(0, 5);
}

export function inspectStdlib(
  query: string,
  catalog: StdlibCatalog = stdlibCatalog(),
): StdlibLookupResult {
  const qualified = query.includes("::");
  const modules = qualified ? [] : catalog.modules.filter((module) => module.name === query);
  const entries = catalog.entries.filter((entry) =>
    qualified ? entry.qualifiedName === query : entry.name === query,
  );
  const matches: (StdlibEntry | StdlibModule)[] = [...modules, ...entries];
  if (matches.length === 1) return { ok: true, value: matches[0] as StdlibEntry | StdlibModule };
  if (matches.length > 1) {
    const candidates = matches
      .map((match) => (match.type === "module" ? `module::${match.name}` : match.qualifiedName))
      .sort();
    return {
      ok: false,
      error: {
        code: "stdlib.ambiguous",
        query,
        message: `Standard-library name '${query}' is ambiguous. Use a qualified name.`,
        candidates,
        suggestions: [],
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "stdlib.unknown",
      query,
      message: `Unknown standard-library name '${query}'.`,
      candidates: [],
      suggestions: suggestionsFor(catalog, query),
    },
  };
}

function summary(entry: StdlibEntry): string {
  const signatures =
    entry.signatures.length > 0 ? entry.signatures.join(" | ") : "type not declared";
  return `  ${entry.qualifiedName}  ${entry.kind}  ${signatures}${entry.documented ? "" : "  [undocumented]"}`;
}

export function renderStdlibList(catalog: StdlibCatalog = stdlibCatalog()): string {
  const globalEntries = catalog.entries.filter((entry) => entry.scope === "global");
  const category = (value: StdlibCategory): StdlibEntry[] =>
    globalEntries.filter((entry) => entry.category === value);
  const lines = [
    `MeTTa standard library and extensions: ${catalog.counts.entries} entries (${catalog.counts.coreGlobalEntries} core global, ${catalog.counts.lspExtensionEntries} LSP extension, ${catalog.counts.hostExtensionEntries} host extensions, ${catalog.counts.moduleEntries} from ${catalog.counts.modules} modules)`,
    "",
    "Core global entries",
    ...category("core").map(summary),
    "",
    "MeTTa-LSP extensions",
    ...category("lsp-extension").map(summary),
    "",
    "Host bridge extensions (no import; requires the matching unguarded host bridge)",
    ...category("host-extension").map(summary),
  ];
  for (const module of catalog.modules) {
    lines.push("", `Module ${module.name}`, `Import: ${module.importForm}`);
    const exports = new Set(module.exports);
    lines.push(...catalog.entries.filter((entry) => exports.has(entry.qualifiedName)).map(summary));
  }
  return lines.join("\n");
}

function renderParam(param: MettaDocParam, index: number): string {
  const type = param.type.length > 0 ? `${param.type}: ` : "";
  return `  ${index + 1}. ${type}${param.description || "undocumented"}`;
}

export function renderStdlibInspection(value: StdlibEntry | StdlibModule): string {
  if (value.type === "module") {
    return [
      `Module ${value.name}`,
      `Import: ${value.importForm}`,
      `Exports (${value.exports.length}):`,
      ...value.exports.map((name) => `  ${name}`),
    ].join("\n");
  }
  const lines = [
    `${value.name} (${value.qualifiedName})`,
    `Kind: ${value.kind}`,
    `Availability: ${
      value.scope === "module"
        ? `import module ${value.module ?? ""}`
        : value.category === "core"
          ? "core global"
          : value.category === "lsp-extension"
            ? "MeTTa-LSP extension"
            : "host extension; matching unguarded host bridge required"
    }`,
    "Signatures:",
    ...(value.signatures.length > 0
      ? value.signatures.map((signature) => `  ${signature}`)
      : ["  type not declared"]),
  ];
  if (value.description.length > 0) lines.push("", value.description);
  if (value.parameters.length > 0)
    lines.push("", "Parameters:", ...value.parameters.map(renderParam));
  if (value.returns !== null) {
    const type = value.returns.type.length > 0 ? `${value.returns.type}: ` : "";
    lines.push("", `Returns: ${type}${value.returns.description || "undocumented"}`);
  }
  if (!value.documented) lines.push("", "Documentation: not available");
  if (value.deprecated) lines.push("", "Deprecated.");
  lines.push("", `Source: ${value.source}`);
  return lines.join("\n");
}

export function renderStdlibError(error: StdlibLookupError): string {
  const lines = [error.message];
  if (error.candidates.length > 0)
    lines.push("Candidates:", ...error.candidates.map((candidate) => `  ${candidate}`));
  if (error.suggestions.length > 0)
    lines.push("Did you mean:", ...error.suggestions.map((suggestion) => `  ${suggestion}`));
  return lines.join("\n");
}
