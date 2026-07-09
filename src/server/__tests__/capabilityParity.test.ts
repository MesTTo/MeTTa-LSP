// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The capability-parity gate (§2.10): the capability ledger is the single source of truth, and this test
// asserts the surfaces do not drift from it. It checks (1) registry integrity, (2) the canonical lsp_* MCP
// tools match the ledger's declared mcpTools exactly, (3) every agent-friendly metta_* alias targets a
// canonical tool the ledger declares, and (4) every ledger lspMethod on the LSP surface is actually
// advertised by the server's ServerCapabilities (and no provider is advertised without a ledger entry). A
// tool, provider, or handler added or removed without updating the ledger fails here. (The MCP tool list is
// source-scanned rather than imported because that adapter attaches stdin listeners at import; the server's
// capabilities are extracted into an importable serverCapabilities() so they can be checked directly.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ServerCapabilities } from "vscode-languageserver-protocol";
import type { CapabilityDescriptor } from "../../language-service/index.js";
import { CAPABILITIES, CAPABILITY_IDS } from "../../language-service/index.js";
import { EXECUTE_COMMANDS, serverCapabilities } from "../serverCapabilities.js";

// The ledger is declared `as const` so CapabilityId stays a precise union of ids. Read it here through the
// wider CapabilityDescriptor view so surfaces/mcpTools carry their declared element types (a const tuple's
// `.includes`/`Set.has` otherwise narrow their argument to the literal union, or to never across entries).
const LEDGER: readonly CapabilityDescriptor[] = CAPABILITIES;

const mcpSource = readFileSync(
  fileURLToPath(new URL("../../mcp/server.ts", import.meta.url)),
  "utf8",
);
// Tool definitions are `    name: "..."` at four-space indent; the inline serverInfo name is not.
const registeredTools = [...mcpSource.matchAll(/^ {4}name: "([a-z_]+)",/gm)].map((m) => m[1] ?? "");
// The alias map: `  metta_x: "lsp_y",`.
const aliasMap = new Map(
  [...mcpSource.matchAll(/^ {2}(metta_[a-z_]+): "(lsp[a-z_]*)",/gm)].map((m) => [
    m[1] ?? "",
    m[2] ?? "",
  ]),
);

const VALID_SURFACES = new Set<string>(["lsp", "mcp", "cli", "vscode", "agent"]);
const VALID_STABILITY = new Set<string>(["stable", "preview", "experimental"]);
const isCanonical = (tool: string): boolean => tool === "lsp" || tool.startsWith("lsp_");

describe("capability registry integrity", () => {
  it("has unique ids and well-formed descriptors", () => {
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
    const problems: string[] = [];
    for (const capability of LEDGER) {
      if (capability.title.length === 0) problems.push(`${capability.id}: empty title`);
      if (!VALID_STABILITY.has(capability.stability))
        problems.push(`${capability.id}: bad stability ${capability.stability}`);
      for (const surface of capability.surfaces) {
        if (!VALID_SURFACES.has(surface)) problems.push(`${capability.id}: bad surface ${surface}`);
      }
      if (capability.surfaces.includes("lsp") && capability.lspMethods.length === 0)
        problems.push(`${capability.id}: on the lsp surface with no lspMethods`);
      if (capability.surfaces.includes("mcp") && capability.mcpTools.length === 0)
        problems.push(`${capability.id}: on the mcp surface with no mcpTools`);
    }
    expect(problems).toStrictEqual([]);
  });
});

describe("capability parity — MCP tools track the ledger", () => {
  it("registered canonical lsp_* tools equal the declared lsp_* mcpTools exactly", () => {
    const registered = new Set(registeredTools.filter(isCanonical));
    const declared = new Set(LEDGER.flatMap((c) => [...c.mcpTools]).filter(isCanonical));
    const extra = [...registered].filter((tool) => !declared.has(tool)).sort();
    const missing = [...declared].filter((tool) => !registered.has(tool)).sort();
    expect({ extra, missing }).toStrictEqual({ extra: [], missing: [] });
  });

  it("every metta_* alias targets a canonical tool the ledger declares", () => {
    const declared = new Set(LEDGER.flatMap((c) => [...c.mcpTools]).filter(isCanonical));
    const aliases = registeredTools.filter((tool) => tool.startsWith("metta_"));
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      const target = aliasMap.get(alias);
      expect(target, `alias ${alias} is not in the alias map`).toBeDefined();
      expect(
        declared.has(target ?? ""),
        `${alias} -> ${target ?? "?"} is not a declared tool`,
      ).toBe(true);
    }
  });
});

const serverSource = readFileSync(fileURLToPath(new URL("../server.ts", import.meta.url)), "utf8");
const requestConstants = readFileSync(
  fileURLToPath(new URL("../shared/lspRequests.ts", import.meta.url)),
  "utf8",
);
const asObj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

// Each standard LSP method the ledger can declare, mapped to the ServerCapabilities provider key that
// advertises it plus a predicate reading whether the server actually turns it on. Sub-methods
// (completionItem/resolve, callHierarchy/*, prepareRename) fold into their parent provider. This is the one
// place the LSP spec's method -> provider mapping lives, so an unmapped standard method fails loudly.
const PROVIDER: Record<
  string,
  { key: keyof ServerCapabilities; on: (c: ServerCapabilities) => boolean }
> = {
  "textDocument/hover": { key: "hoverProvider", on: (c) => Boolean(c.hoverProvider) },
  "textDocument/definition": {
    key: "definitionProvider",
    on: (c) => Boolean(c.definitionProvider),
  },
  "textDocument/references": {
    key: "referencesProvider",
    on: (c) => Boolean(c.referencesProvider),
  },
  "textDocument/implementation": {
    key: "implementationProvider",
    on: (c) => Boolean(c.implementationProvider),
  },
  "textDocument/typeDefinition": {
    key: "typeDefinitionProvider",
    on: (c) => Boolean(c.typeDefinitionProvider),
  },
  "textDocument/declaration": {
    key: "declarationProvider",
    on: (c) => Boolean(c.declarationProvider),
  },
  "textDocument/documentSymbol": {
    key: "documentSymbolProvider",
    on: (c) => Boolean(c.documentSymbolProvider),
  },
  "workspace/symbol": {
    key: "workspaceSymbolProvider",
    on: (c) => Boolean(c.workspaceSymbolProvider),
  },
  "textDocument/formatting": {
    key: "documentFormattingProvider",
    on: (c) => Boolean(c.documentFormattingProvider),
  },
  "textDocument/rangeFormatting": {
    key: "documentRangeFormattingProvider",
    on: (c) => Boolean(c.documentRangeFormattingProvider),
  },
  "textDocument/onTypeFormatting": {
    key: "documentOnTypeFormattingProvider",
    on: (c) => Boolean(c.documentOnTypeFormattingProvider),
  },
  "textDocument/rename": { key: "renameProvider", on: (c) => Boolean(c.renameProvider) },
  "textDocument/prepareRename": {
    key: "renameProvider",
    on: (c) => asObj(c.renameProvider).prepareProvider === true,
  },
  "workspace/willRenameFiles": {
    key: "workspace",
    on: (c) => Boolean(asObj(asObj(c.workspace).fileOperations).willRename),
  },
  "textDocument/completion": {
    key: "completionProvider",
    on: (c) => Boolean(c.completionProvider),
  },
  "completionItem/resolve": {
    key: "completionProvider",
    on: (c) => asObj(c.completionProvider).resolveProvider === true,
  },
  "textDocument/signatureHelp": {
    key: "signatureHelpProvider",
    on: (c) => Boolean(c.signatureHelpProvider),
  },
  "textDocument/codeAction": {
    key: "codeActionProvider",
    on: (c) => Boolean(c.codeActionProvider),
  },
  "textDocument/semanticTokens/full": {
    key: "semanticTokensProvider",
    on: (c) => Boolean(asObj(c.semanticTokensProvider).full),
  },
  "textDocument/semanticTokens/range": {
    key: "semanticTokensProvider",
    on: (c) => Boolean(asObj(c.semanticTokensProvider).range),
  },
  "textDocument/foldingRange": {
    key: "foldingRangeProvider",
    on: (c) => Boolean(c.foldingRangeProvider),
  },
  "textDocument/inlayHint": { key: "inlayHintProvider", on: (c) => Boolean(c.inlayHintProvider) },
  "textDocument/documentHighlight": {
    key: "documentHighlightProvider",
    on: (c) => Boolean(c.documentHighlightProvider),
  },
  "textDocument/linkedEditingRange": {
    key: "linkedEditingRangeProvider",
    on: (c) => Boolean(c.linkedEditingRangeProvider),
  },
  "textDocument/documentLink": {
    key: "documentLinkProvider",
    on: (c) => Boolean(c.documentLinkProvider),
  },
  "textDocument/selectionRange": {
    key: "selectionRangeProvider",
    on: (c) => Boolean(c.selectionRangeProvider),
  },
  "textDocument/codeLens": { key: "codeLensProvider", on: (c) => Boolean(c.codeLensProvider) },
  "textDocument/prepareCallHierarchy": {
    key: "callHierarchyProvider",
    on: (c) => Boolean(c.callHierarchyProvider),
  },
  "callHierarchy/incomingCalls": {
    key: "callHierarchyProvider",
    on: (c) => Boolean(c.callHierarchyProvider),
  },
  "callHierarchy/outgoingCalls": {
    key: "callHierarchyProvider",
    on: (c) => Boolean(c.callHierarchyProvider),
  },
  "textDocument/diagnostic": {
    key: "diagnosticProvider",
    on: (c) => Boolean(c.diagnosticProvider),
  },
  "workspace/diagnostic": { key: "diagnosticProvider", on: (c) => Boolean(c.diagnosticProvider) },
};

// publishDiagnostics is a push notification with no capability flag; structural keys are not tied to one
// ledger method.
const PUSH_METHODS = new Set<string>(["textDocument/publishDiagnostics"]);
const STRUCTURAL_KEYS = new Set<string>([
  "textDocumentSync",
  "workspace",
  "executeCommandProvider",
]);
const lspMethodsDeclared = LEDGER.filter((c) => c.surfaces.includes("lsp")).flatMap((c) => [
  ...c.lspMethods,
]);

describe("capability parity — the LSP surface tracks the ledger", () => {
  const caps = serverCapabilities();

  it("advertises a provider (or handler) for every ledger LSP method", () => {
    const problems: string[] = [];
    for (const method of lspMethodsDeclared) {
      if (method.startsWith("metta/")) {
        if (!serverSource.includes(method) && !requestConstants.includes(method))
          problems.push(`custom method ${method} is not registered in the server`);
        continue;
      }
      if (method.startsWith("workspace/executeCommand:")) {
        const command = method.slice("workspace/executeCommand:".length);
        if (!(EXECUTE_COMMANDS as readonly string[]).includes(command))
          problems.push(`command ${command} is not in executeCommandProvider.commands`);
        continue;
      }
      if (PUSH_METHODS.has(method)) continue;
      const entry = PROVIDER[method];
      if (entry === undefined) {
        problems.push(`no provider mapping for standard method ${method}`);
        continue;
      }
      if (!entry.on(caps)) problems.push(`${method} declared but ${entry.key} not advertised`);
    }
    expect(problems).toStrictEqual([]);
  });

  it("advertises no provider without a declaring ledger LSP method", () => {
    const required = new Set<string>(STRUCTURAL_KEYS);
    for (const method of lspMethodsDeclared) {
      const entry = PROVIDER[method];
      if (entry !== undefined) required.add(entry.key);
    }
    const extra = Object.entries(caps)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key)
      .filter((key) => !required.has(key))
      .sort();
    expect(extra).toStrictEqual([]);
  });
});
