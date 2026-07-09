// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Host-agnostic file access. The analysis engine reads through this interface so it pulls no node
// builtins: the node host backs it with node:fs, the browser host with a preloaded in-memory map, and
// tests with a literal map. Reads are synchronous. The browser host loads the workspace into memory once
// (the one async step, at the host boundary), after which the engine reads it synchronously like any
// other host.

import { dirname, normalize } from "pathe";

export interface FileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface FileProvider {
  // Convert an editor/workspace URI to the provider's path key. Providers that do not need virtual schemes
  // can omit this and the analyzer falls back to file:// paths.
  uriToPath?(uri: string): string | null;
  // Convert a provider path key back to the URI the editor knows. Used when import resolution finds a file.
  pathToUri?(fsPath: string): string;
  // The file's UTF-8 text, or null if it is absent or unreadable.
  readFile(fsPath: string): string | null;
  // Metadata for a path, or null if it is absent or unreadable.
  stat(fsPath: string): FileStat | null;
  // Directory entry names (not full paths), or null if the path is not a readable directory.
  readDir(fsPath: string): readonly string[] | null;
  // Base directory for resolving relative paths: the process working directory on node, the workspace
  // root on the web.
  cwd(): string;
}

function utf8Size(text: string): number {
  return new TextEncoder().encode(text).length;
}

// A file system held entirely in memory. The browser host preloads it from an async workspace read and
// tests populate it directly with writeFile. Directories are implied by the file paths present.
export class InMemoryFileProvider implements FileProvider {
  private readonly files = new Map<string, { readonly text: string; readonly mtimeMs: number }>();
  private clock = 0;

  public constructor(private readonly baseDir = "/") {}

  public writeFile(fsPath: string, text: string): void {
    this.files.set(normalize(fsPath), { text, mtimeMs: ++this.clock });
  }

  public deleteFile(fsPath: string): void {
    this.files.delete(normalize(fsPath));
  }

  public readFile(fsPath: string): string | null {
    return this.files.get(normalize(fsPath))?.text ?? null;
  }

  public stat(fsPath: string): FileStat | null {
    const key = normalize(fsPath);
    const file = this.files.get(key);
    if (file) {
      return {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mtimeMs: file.mtimeMs,
        size: utf8Size(file.text),
      };
    }
    const prefix = key.endsWith("/") ? key : `${key}/`;
    for (const path of this.files.keys()) {
      if (path === key || dirname(path) === key || path.startsWith(prefix)) {
        return { isFile: false, isDirectory: true, isSymbolicLink: false, mtimeMs: 0, size: 0 };
      }
    }
    return null;
  }

  public readDir(fsPath: string): readonly string[] | null {
    const key = normalize(fsPath);
    const prefix = key.endsWith("/") ? key : `${key}/`;
    const entries = new Set<string>();
    let isDirectory = false;
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      isDirectory = true;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      entries.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    return isDirectory ? [...entries] : null;
  }

  public cwd(): string {
    return this.baseDir;
  }
}
