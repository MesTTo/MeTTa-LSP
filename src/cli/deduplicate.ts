// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import {
  type DeduplicateDocument,
  type DeduplicateResult,
  deduplicate,
  pathToUri,
} from "../language-service/index.js";

const DEFAULT_MAX_FILES = 4_000;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".metta-lsp-cache",
  ".venv",
  "__pycache__",
  "dist",
  "node_modules",
  "out",
]);

export interface DeduplicateCliOptions {
  readonly minAtoms?: number;
  readonly minLines?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly ignore?: readonly string[];
}

export interface DeduplicateScanIssue {
  readonly path: string;
  readonly code: "file-not-found" | "not-a-file" | "read-error" | "file-too-large" | "max-files";
  readonly message: string;
}

export interface DeduplicateCliResult extends DeduplicateResult {
  readonly scanIssues: readonly DeduplicateScanIssue[];
  readonly files: readonly string[];
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.trunc(value));
}

function normalizedRelative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function explicitDocument(
  file: string,
  scanIssues: DeduplicateScanIssue[],
): DeduplicateDocument | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      scanIssues.push({
        path: file,
        code: "not-a-file",
        message: `${file} is not a regular file`,
      });
      return null;
    }
    return { uri: pathToUri(file), text: fs.readFileSync(file, "utf8") };
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
        ? "file-not-found"
        : "read-error";
    scanIssues.push({
      path: file,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function discoverDirectory(
  root: string,
  options: Required<Pick<DeduplicateCliOptions, "maxFiles" | "maxFileBytes">>,
  ignored: (relative: string) => boolean,
  files: string[],
  scanIssues: DeduplicateScanIssue[],
  state: { truncated: boolean },
): void {
  const visit = (directory: string): void => {
    if (files.length >= options.maxFiles) {
      state.truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      scanIssues.push({
        path: directory,
        code: "read-error",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= options.maxFiles) {
        state.truncated = true;
        return;
      }
      const resolved = path.join(directory, entry.name);
      const relative = normalizedRelative(resolved);
      const absolute = resolved.split(path.sep).join("/");
      if (ignored(relative) || ignored(absolute) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) visit(resolved);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".metta") continue;
      let bytes: number;
      try {
        bytes = fs.statSync(resolved).size;
      } catch (error) {
        scanIssues.push({
          path: resolved,
          code: "read-error",
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (bytes > options.maxFileBytes) {
        scanIssues.push({
          path: resolved,
          code: "file-too-large",
          message: `${resolved} is ${bytes} bytes; limit is ${options.maxFileBytes}`,
        });
      } else files.push(resolved);
    }
  };
  visit(root);
}

export function deduplicatePaths(
  targets: readonly string[],
  options: DeduplicateCliOptions = {},
): DeduplicateCliResult {
  const maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
  const maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES);
  const ignoreMatchers = (options.ignore ?? []).map((pattern) => picomatch(pattern, { dot: true }));
  const ignored = (relative: string): boolean =>
    ignoreMatchers.some((matches) => matches(relative) || matches(`/${relative}`));
  const scanIssues: DeduplicateScanIssue[] = [];
  const files: string[] = [];
  const explicitFiles: string[] = [];
  const scanState = { truncated: false };

  for (const target of targets) {
    const resolved = path.resolve(target);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch (error) {
      scanIssues.push({
        path: resolved,
        code: "file-not-found",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (stat.isDirectory())
      discoverDirectory(
        resolved,
        { maxFiles, maxFileBytes },
        ignored,
        files,
        scanIssues,
        scanState,
      );
    else explicitFiles.push(resolved);
  }

  const uniqueFiles = [...new Set([...explicitFiles, ...files])].sort();
  if (scanState.truncated)
    scanIssues.push({
      path: process.cwd(),
      code: "max-files",
      message: `workspace scan reached the ${maxFiles}-file limit`,
    });
  const documents = uniqueFiles.flatMap((file) => {
    const document = explicitDocument(file, scanIssues);
    return document === null ? [] : [document];
  });
  const result = deduplicate(documents, {
    minAtoms: options.minAtoms,
    minLines: options.minLines,
  });
  return {
    ...result,
    complete: result.complete && scanIssues.length === 0,
    scanIssues,
    files: documents.map((document) => fileURLToPath(document.uri)),
  };
}

export function renderDeduplicate(result: DeduplicateCliResult): string {
  const lines: string[] = [];
  for (const clone of result.clones) {
    lines.push(
      `${clone.id} [${clone.kind}] ${clone.atoms} atoms, ${clone.lines} line${clone.lines === 1 ? "" : "s"}, ${clone.role}`,
    );
    for (const occurrence of clone.occurrences)
      lines.push(
        `  ${fileURLToPath(occurrence.uri)}:${occurrence.startLine}:${occurrence.startColumn}  ${occurrence.text.replaceAll(/\s+/g, " ")}`,
      );
  }
  for (const issue of result.issues)
    lines.push(`error ${fileURLToPath(issue.uri)}:${issue.start}: ${issue.code}: ${issue.message}`);
  for (const issue of result.scanIssues)
    lines.push(`error ${issue.path}: ${issue.code}: ${issue.message}`);
  lines.push(
    `${result.stats.clones} clone${result.stats.clones === 1 ? "" : "s"}, ${result.stats.duplicateAtoms}/${result.stats.totalAtoms} duplicate atoms (${result.stats.duplicateAtomPercent.toFixed(2)}%), ${result.stats.duplicateLines}/${result.stats.totalLines} duplicate lines (${result.stats.duplicateLinePercent.toFixed(2)}%)`,
  );
  return lines.join("\n");
}
