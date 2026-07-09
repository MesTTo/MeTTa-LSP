// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The server's advertised LSP capabilities as a pure, importable value. Kept out of server.ts (which opens
// a stdio connection at module load) so tests and alternate hosts can read the exact provider set. The
// capability-parity test maps each ledger lspMethod to its provider key here, so a handler wired without an
// advertised provider (or a provider advertised without a ledger entry) fails the drift gate.

import {
  CodeActionKind,
  type ServerCapabilities,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol";
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from "./analyzer.js";

// The workspace/executeCommand commands the server handles for non-VS-Code clients. They are namespaced
// under metta.lsp.* so vscode-languageclient's auto-registration of them does not collide with the identical
// user-facing metta.* commands the VS Code client registers itself (with richer webview/output behaviour).
export const EXECUTE_COMMANDS = [
  "metta.lsp.evaluateGuarded",
  "metta.lsp.organizeImports",
  "metta.lsp.trace",
  "metta.lsp.noop",
] as const;

export function serverCapabilities(): ServerCapabilities {
  return {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    workspace: {
      workspaceFolders: { supported: true, changeNotifications: true },
      // Update import!/include references when a .metta file is renamed. willRename returns the edits as part
      // of the rename so they land atomically with it.
      fileOperations: {
        willRename: {
          filters: [{ pattern: { glob: "**/*.metta" } }],
        },
      },
    },
    hoverProvider: true,
    definitionProvider: true,
    referencesProvider: true,
    implementationProvider: true,
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    documentFormattingProvider: true,
    documentRangeFormattingProvider: true,
    documentOnTypeFormattingProvider: {
      firstTriggerCharacter: "\n",
      moreTriggerCharacter: [")", "]", "}"],
    },
    renameProvider: { prepareProvider: true },
    completionProvider: {
      resolveProvider: true,
      triggerCharacters: ["(", " ", ":", "$", "&", '"'],
    },
    signatureHelpProvider: { triggerCharacters: ["(", " "], retriggerCharacters: [" "] },
    codeActionProvider: {
      codeActionKinds: [
        CodeActionKind.QuickFix,
        CodeActionKind.SourceOrganizeImports,
        CodeActionKind.RefactorRewrite,
      ],
    },
    semanticTokensProvider: {
      legend: {
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
      },
      full: true,
      range: true,
    },
    foldingRangeProvider: true,
    inlayHintProvider: true,
    callHierarchyProvider: true,
    documentHighlightProvider: true,
    linkedEditingRangeProvider: true,
    selectionRangeProvider: true,
    documentLinkProvider: { resolveProvider: false },
    typeDefinitionProvider: true,
    declarationProvider: true,
    codeLensProvider: { resolveProvider: false },
    executeCommandProvider: {
      commands: [...EXECUTE_COMMANDS],
    },
    diagnosticProvider: {
      identifier: "metta",
      interFileDependencies: true,
      workspaceDiagnostics: true,
    },
  };
}
