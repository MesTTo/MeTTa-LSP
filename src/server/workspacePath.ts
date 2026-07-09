// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { realpathSync } from "node:fs";
import * as path from "node:path";

function canonicalPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// Existing paths are compared after resolving symlinks. Nonexistent paths still receive a lexical check.
export function pathIsInsideWorkspace(rootPath: string, candidatePath: string): boolean {
  const root = canonicalPath(rootPath);
  const candidate = canonicalPath(candidatePath);
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
