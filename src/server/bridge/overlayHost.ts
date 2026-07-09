// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A `ts.LanguageServiceHost` that reads the user's TypeScript project from disk through `ts.sys` with a
// version-tracked in-memory overlay on top. The bridge injects synthetic probe files into the overlay to
// resolve `(js-atom "path")` globals, and reads the ambient lib from the installed typescript via
// `getDefaultLibFilePath` (an absolute path, so a disk-backed host resolves `Math`, `Promise`, DOM globals).
// The host + project discovery follow Microsoft's `@typescript/vfs` host and the TypeScript wiki's
// incremental-build host, verified end to end against a fixture project.

import * as nodePath from "node:path";
import * as ts from "typescript";

interface OverlayFile {
  readonly version: number;
  readonly text: string;
}

export class OverlayLanguageServiceHost implements ts.LanguageServiceHost {
  private readonly overlay = new Map<string, OverlayFile>();
  private readonly rootFileNames: Set<string>;
  private projectVersion = 0;

  public constructor(
    private readonly projectDir: string,
    private readonly compilerOptions: ts.CompilerOptions,
    rootFileNames: readonly string[],
  ) {
    // TypeScript keys files by absolute, forward-slash paths internally; normalise on the way in so later
    // overlay lookups (also normalised) hit.
    this.rootFileNames = new Set(rootFileNames.map((file) => nodePath.resolve(file)));
  }

  // Inject or replace an in-memory file (a probe, or an open buffer). The bumped version invalidates the
  // service's cached snapshot; adding the key to the root list makes the service actually see the file.
  public setOverlay(fileName: string, text: string): void {
    const key = nodePath.resolve(fileName);
    const previous = this.overlay.get(key);
    this.overlay.set(key, { version: (previous?.version ?? 0) + 1, text });
    this.rootFileNames.add(key);
    this.projectVersion += 1;
  }

  public getProjectVersion(): string {
    return String(this.projectVersion);
  }

  public getCompilationSettings(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  public getScriptFileNames(): string[] {
    return [...this.rootFileNames];
  }

  public getScriptVersion(fileName: string): string {
    const key = nodePath.resolve(fileName);
    const entry = this.overlay.get(key);
    if (entry) return `o${String(entry.version)}`;
    const mtime = ts.sys.getModifiedTime?.(key);
    return mtime ? `d${String(mtime.getTime())}` : "d0";
  }

  public getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const key = nodePath.resolve(fileName);
    const entry = this.overlay.get(key);
    if (entry) return ts.ScriptSnapshot.fromString(entry.text);
    const disk = ts.sys.readFile(key);
    return disk === undefined ? undefined : ts.ScriptSnapshot.fromString(disk);
  }

  public getCurrentDirectory(): string {
    return this.projectDir;
  }

  // The ABSOLUTE path into the installed typescript's lib, not the bare `lib.esnext.d.ts` name: a
  // disk-backed host must load the real file, or the program has no ambient globals at all.
  public getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  public fileExists(fileName: string): boolean {
    return this.overlay.has(nodePath.resolve(fileName)) || ts.sys.fileExists(fileName);
  }

  public readFile(fileName: string, encoding?: string): string | undefined {
    const entry = this.overlay.get(nodePath.resolve(fileName));
    return entry ? entry.text : ts.sys.readFile(fileName, encoding);
  }

  public readDirectory(
    dir: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[] {
    return ts.sys.readDirectory(dir, extensions, exclude, include, depth);
  }

  public directoryExists(directoryName: string): boolean {
    return ts.sys.directoryExists(directoryName);
  }

  public getDirectories(directoryName: string): string[] {
    return ts.sys.getDirectories(directoryName);
  }

  public useCaseSensitiveFileNames(): boolean {
    return ts.sys.useCaseSensitiveFileNames;
  }

  public realpath(path: string): string {
    return ts.sys.realpath ? ts.sys.realpath(path) : path;
  }
}

// A `lib` that carries both the ESNext intrinsics (so `Math`, `Number`, `JSON` resolve) and the DOM (so
// `document`, `window` resolve) — the two families a `(js-atom "path")` global is most likely to name.
const DEFAULT_LIB = ["lib.esnext.full.d.ts"];

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  lib: DEFAULT_LIB,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  checkJs: false,
  noEmit: true,
  strict: false,
};

export interface HostServiceBundle {
  readonly service: ts.LanguageService;
  readonly host: OverlayLanguageServiceHost;
  // The tsconfig that configured the project, or null when a default-lib-only service was created (still
  // enough to probe globals, but with no workspace files indexed for registered operations).
  readonly configPath: string | null;
}

// A language service over the TypeScript project rooted at (or above) `searchFrom`. Uses the nearest
// tsconfig.json when there is one — its options and file set index registered operations and give probes the
// workspace's own types. Falls back to a default-lib-only service so `(js-atom "Math.max")` still resolves
// in a project with no tsconfig.
export function createHostService(searchFrom: string): HostServiceBundle {
  // `ts.sys` methods are unbound but reference no `this`; wrap them so the linter's unbound-method guard is
  // satisfied without a suppression.
  const fileExists = (file: string): boolean => ts.sys.fileExists(file);
  const readFile = (file: string): string | undefined => ts.sys.readFile(file);
  const configPath = ts.findConfigFile(searchFrom, fileExists, "tsconfig.json") ?? null;
  let options: ts.CompilerOptions;
  let fileNames: readonly string[];
  let projectDir: string;
  if (configPath !== null) {
    projectDir = nodePath.dirname(configPath);
    const parsed = ts.parseJsonConfigFileContent(
      ts.readConfigFile(configPath, readFile).config,
      ts.sys,
      projectDir,
      undefined,
      configPath,
    );
    options = { ...parsed.options, noEmit: true };
    fileNames = parsed.fileNames;
  } else {
    projectDir = searchFrom;
    options = { ...DEFAULT_OPTIONS };
    fileNames = [];
  }
  const host = new OverlayLanguageServiceHost(projectDir, options, fileNames);
  const registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, projectDir);
  const service = ts.createLanguageService(host, registry);
  return { service, host, configPath };
}
