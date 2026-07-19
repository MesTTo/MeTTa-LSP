// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { TextEdit, WorkspaceEdit } from "vscode-languageserver-types";
import { uriToPath } from "../language-service/index.js";
import { pathIsInsideWorkspace } from "../server/workspacePath.js";

export interface AppliedEdits {
  readonly files: readonly string[];
  readonly changed: boolean;
}

function guardedPathForUri(uri: string, roots: readonly string[]): string {
  const filePath = uriToPath(uri);
  const displayPath = filePath === null ? uri : path.resolve(filePath);
  if (
    filePath === null ||
    !roots.some((root) => pathIsInsideWorkspace(root, path.resolve(filePath)))
  )
    throw new Error(`metta LSP will not modify a file outside the workspace: ${displayPath}`);
  return path.resolve(filePath);
}

// Apply LSP TextEdits with the standard text-document implementation so offset and ordering semantics
// stay aligned with VS Code's LSP utilities.
function applyTextEditsToFile(
  uri: string,
  edits: readonly TextEdit[],
  roots: readonly string[],
): { path: string; changed: boolean } {
  const filePath = guardedPathForUri(uri, roots);
  const text = readFileSync(filePath, "utf8");
  const doc = TextDocument.create(uri, "metta", 0, text);
  const next = TextDocument.applyEdits(doc, [...edits]);
  if (next !== text) writeFileSync(filePath, next, "utf8");
  return { path: filePath, changed: next !== text };
}

export function applyWorkspaceEditToFiles(
  edit: WorkspaceEdit,
  roots: readonly string[],
): AppliedEdits {
  const files: string[] = [];
  let changed = false;
  for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
    const result = applyTextEditsToFile(uri, edits, roots);
    files.push(result.path);
    changed ||= result.changed;
  }
  return { files, changed };
}

export function applyDocumentEdits(
  uri: string,
  edits: readonly TextEdit[],
  roots: readonly string[],
): AppliedEdits {
  const result = applyTextEditsToFile(uri, edits, roots);
  return { files: [result.path], changed: result.changed };
}
