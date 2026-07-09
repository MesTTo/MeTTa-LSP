// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The single normalization point for file identity (§2.3). A `file://` URI and the OS path it denotes can
// be written many ways (drive-letter case, `.` segments, trailing slashes); every one must map to one
// canonical string so the interner and every cache key agree on "same file". These helpers are neutral
// (only `pathe` + `vscode-uri`, no node builtins) so they compile identically for node, the browser worker,
// and tests.

import * as path from "pathe";
import { URI } from "vscode-uri";

const METTA_EXTENSIONS = new Set([".metta"]);

// Whether a path names a MeTTa source file (the workspace scan indexes only these).
export function isMettaFile(filePath: string): boolean {
  return METTA_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// Canonicalize a URI to its stable identity. A `file://` URI is round-tripped through its fs path so
// equivalent spellings collapse to one form; a non-file URI (e.g. `metta://stdlib/...`) is returned as-is.
export function normalizeUri(uri: string): string {
  if (!uri.startsWith("file://")) return uri;
  try {
    return URI.file(URI.parse(uri).fsPath).toString();
  } catch {
    return uri;
  }
}

// The OS path a `file://` URI denotes, or null for a non-file URI.
export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    return URI.parse(uri).fsPath;
  } catch {
    return null;
  }
}

// The `file://` URI for an absolute OS path (callers resolve to absolute before calling).
export function pathToUri(filePath: string): string {
  return URI.file(filePath).toString();
}
