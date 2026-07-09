// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// IDE-agnostic configuration shape normalization. Clients deliver the server's settings differently:
//
//   - VS Code and Emacs (lsp-mode, eglot) pull via workspace/configuration and push a section-keyed tree
//     `{ "metta": { ... } }` in workspace/didChangeConfiguration.
//   - Neovim (nvim-lspconfig) and Sublime LSP push the same section-keyed tree and also pass it at
//     initialize via initializationOptions.
//   - Helix sends its `[language-server.<name>.config]` table as initializationOptions, either the section
//     contents directly `{ ... }` or wrapped `{ "metta": { ... } }` depending on how the user writes it.
//
// So a settings tree may be section-keyed or the section's contents directly. This picks out the `metta`
// section either way, and treats a JSON null (a client reverting an override) as "use defaults".

import { DEFAULT_SETTINGS } from "./analyzer.js";
import type {
  DiagnosticSettings,
  FormatSettings,
  PrologSettings,
  RunSettings,
  RuntimeGuardSettings,
  RuntimeSettings,
  ServerSettings,
  WorkspaceSettings,
} from "./types.js";

const SECTION = "metta";

export function extractMettaSection(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  if (SECTION in root) return root[SECTION] ?? {};
  return root;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function buildDiagnosticsSettings(diagnostics: Record<string, unknown>): DiagnosticSettings {
  return {
    syntax: diagnostics.syntax !== false,
    duplicateDefinitions: diagnostics.duplicateDefinitions !== false,
    duplicateDefinitionsMode:
      diagnostics.duplicateDefinitionsMode === "global" ? "global" : "local",
    undefinedFunctions: diagnostics.undefinedFunctions !== false,
    undefinedTypes: diagnostics.undefinedTypes !== false,
    undefinedVariables: diagnostics.undefinedVariables === true,
    unboundSpaces: diagnostics.unboundSpaces !== false,
    arity: diagnostics.arity !== false,
    typeMismatch: diagnostics.typeMismatch !== false,
    importResolution: diagnostics.importResolution !== false,
    lint: diagnostics.lint !== false,
    prolog: diagnostics.prolog !== false,
    semanticLint: diagnostics.semanticLint === true,
    bridge: diagnostics.bridge !== false,
  };
}

function buildWorkspaceSettings(workspace: Record<string, unknown>): WorkspaceSettings {
  return {
    maxFiles: numberOr(workspace.maxFiles, DEFAULT_SETTINGS.workspace.maxFiles),
    exclude: Array.isArray(workspace.exclude)
      ? workspace.exclude.filter((item): item is string => typeof item === "string")
      : DEFAULT_SETTINGS.workspace.exclude,
  };
}

function buildGuardSettings(runtime: Record<string, unknown>): RuntimeGuardSettings {
  const guard = asRecord(runtime.guard);
  const guardExperimental = asRecord(guard.experimental);
  return {
    ...DEFAULT_SETTINGS.runtime.guard,
    enabled: guard.enabled !== false,
    engine: guard.engine === "off" ? guard.engine : "metta-ts-core",
    fuel: numberOr(guard.fuel, DEFAULT_SETTINGS.runtime.guard.fuel),
    timeoutMs: numberOr(guard.timeoutMs, DEFAULT_SETTINGS.runtime.guard.timeoutMs),
    maxSourceBytes: numberOr(guard.maxSourceBytes, DEFAULT_SETTINGS.runtime.guard.maxSourceBytes),
    maxResults: numberOr(guard.maxResults, DEFAULT_SETTINGS.runtime.guard.maxResults),
    maxResultChars: numberOr(guard.maxResultChars, DEFAULT_SETTINGS.runtime.guard.maxResultChars),
    maxOutputChars: numberOr(guard.maxOutputChars, DEFAULT_SETTINGS.runtime.guard.maxOutputChars),
    maxStackDepth: numberOr(guard.maxStackDepth, DEFAULT_SETTINGS.runtime.guard.maxStackDepth),
    tabling: guard.tabling !== false,
    experimental: {
      ...DEFAULT_SETTINGS.runtime.guard.experimental,
      hashCons: guardExperimental.hashCons !== false,
      trail: guardExperimental.trail !== false,
      flatAtomspace: guardExperimental.flatAtomspace === true,
    },
  };
}

function buildRuntimeSettings(root: Record<string, unknown>): RuntimeSettings {
  const runtime = asRecord(root.runtime);
  return {
    engine:
      runtime.engine === "metta-ts-node" || runtime.engine === "off"
        ? runtime.engine
        : "metta-ts-core",
    mettaTsCli: stringOr(runtime.mettaTsCli, DEFAULT_SETTINGS.runtime.mettaTsCli),
    nodePath: stringOr(runtime.nodePath, DEFAULT_SETTINGS.runtime.nodePath),
    allowSideEffects: runtime.allowSideEffects !== false,
    guard: buildGuardSettings(runtime),
  };
}

function buildPrologSettings(prolog: Record<string, unknown>): PrologSettings {
  return {
    executable: stringOr(prolog.executable, DEFAULT_SETTINGS.prolog.executable).trim() || "swipl",
    timeoutMs: Math.max(100, numberOr(prolog.timeoutMs, DEFAULT_SETTINGS.prolog.timeoutMs)),
  };
}

function buildRunSettings(run: Record<string, unknown>): RunSettings {
  return {
    fuel: Math.max(0, numberOr(run.fuel, DEFAULT_SETTINGS.run.fuel)),
    timeoutMs: Math.max(0, numberOr(run.timeoutMs, DEFAULT_SETTINGS.run.timeoutMs)),
  };
}

function buildFormatSettings(format: Record<string, unknown>): FormatSettings {
  return {
    width: Math.max(1, numberOr(format.width, DEFAULT_SETTINGS.format.width)),
    indent: Math.max(0, numberOr(format.indent, DEFAULT_SETTINGS.format.indent)),
  };
}

export function configurationToSettings(config: unknown): Partial<ServerSettings> {
  if (config === null || typeof config !== "object") return {};
  const root = config as Record<string, unknown>;
  const hover = asRecord(root.hover);
  const completion = asRecord(root.completion);
  return {
    diagnostics: buildDiagnosticsSettings(asRecord(root.diagnostics)),
    hover: { userDefinitionComments: hover.userDefinitionComments !== false },
    completion: {
      autoImports: completion.autoImports !== false,
      includeSnippets: completion.includeSnippets !== false,
    },
    workspace: buildWorkspaceSettings(asRecord(root.workspace)),
    runtime: buildRuntimeSettings(root),
    prolog: buildPrologSettings(asRecord(root.prolog)),
    run: buildRunSettings(asRecord(root.run)),
    docs: { baseUrl: stringOr(asRecord(root.docs).baseUrl, DEFAULT_SETTINGS.docs.baseUrl).trim() },
    inlayHints: { enabled: asRecord(root.inlayHints).enabled !== false },
    pseudocode: { enabled: asRecord(root.pseudocode).enabled === true },
    format: buildFormatSettings(asRecord(root.format)),
  };
}
