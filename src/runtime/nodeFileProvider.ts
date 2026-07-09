// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The node-backed FileProvider: the single place node:fs meets the engine. Adapters running on node
// (the stdio server, the CLI, the MCP server) construct this and inject it into the analyzer; the browser
// host injects an InMemoryFileProvider instead.

import * as fs from "node:fs";
import type { FileProvider, FileStat } from "../server/fileProvider.js";

export class NodeFileProvider implements FileProvider {
  public readFile(fsPath: string): string | null {
    try {
      return fs.readFileSync(fsPath, "utf8");
    } catch {
      return null;
    }
  }

  public stat(fsPath: string): FileStat | null {
    try {
      // lstat (not stat) so the workspace scan can skip symlinks; for regular files the two agree.
      const stats = fs.lstatSync(fsPath);
      return {
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymbolicLink: stats.isSymbolicLink(),
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      };
    } catch {
      return null;
    }
  }

  public readDir(fsPath: string): readonly string[] | null {
    try {
      return fs.readdirSync(fsPath);
    } catch {
      return null;
    }
  }

  public cwd(): string {
    return process.cwd();
  }
}
