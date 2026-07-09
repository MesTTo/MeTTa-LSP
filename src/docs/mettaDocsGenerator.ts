// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Node-side writer for the generated MeTTa API reference. The CLI and the npm script both call this, so
// `metta-lsp doc` and `npm run docs:metta` produce the same graph, Markdown, and sidebar.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CoreRuntime, pathToUri } from "../language-service/index.js";
import { NodeFileProvider } from "../runtime/nodeFileProvider.js";
import { Analyzer } from "../server/analyzer.js";
import { HostTypeService } from "../server/bridge/hostTypeService.js";
import {
  buildMettaDocIndex,
  hostOperationOutputPath,
  type MettaDocIndex,
  mettaModuleOutputPath,
  renderHostOperationPage,
  renderMettaDocsIndexPage,
  renderMettaDocsJson,
  renderMettaModulePage,
  renderMettaSidebarModule,
} from "./mettaDocs.js";

export interface GenerateMettaDocsOptions {
  readonly repoRoot: string;
  readonly moduleRoots: readonly string[];
  readonly hostRoots: readonly string[];
  readonly docsRoot: string;
  readonly sidebarPath: string;
}

export interface GenerateMettaDocsResult {
  readonly index: MettaDocIndex;
  readonly docsRoot: string;
  readonly sidebarPath: string;
  readonly moduleCount: number;
  readonly symbolCount: number;
  readonly hostOperationCount: number;
}

const DEFAULT_EXCLUDES = [
  "node_modules",
  ".git",
  "dist",
  "out",
  ".venv",
  "__pycache__",
  ".metta-lsp-cache",
  "docs-site/.vitepress/dist",
];

export function defaultMettaDocsOptions(repoRoot: string): GenerateMettaDocsOptions {
  const root = resolve(repoRoot);
  return {
    repoRoot: root,
    moduleRoots: [join(root, "examples")],
    hostRoots: [join(root, "examples")],
    docsRoot: join(root, "docs-site/reference/metta"),
    sidebarPath: join(root, "docs-site/.vitepress/metta-sidebar.generated.ts"),
  };
}

export function parseRootList(root: string, value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(root, entry));
}

function generatedAtFor(docsRoot: string, sourceFingerprint: string): string {
  try {
    const existing = JSON.parse(readFileSync(join(docsRoot, "docs-index.json"), "utf8")) as {
      readonly generatedAt?: unknown;
      readonly sourceFingerprint?: unknown;
    };
    if (
      existing.sourceFingerprint === sourceFingerprint &&
      typeof existing.generatedAt === "string" &&
      !["", "deterministic"].includes(existing.generatedAt)
    )
      return existing.generatedAt;
  } catch {
    // First generation, or an unreadable stale index.
  }
  return new Date().toISOString();
}

function analyzerFor(moduleRoots: readonly string[]): {
  readonly analyzer: Analyzer;
  readonly runtime: CoreRuntime;
} {
  const runtime = new CoreRuntime();
  const analyzer = new Analyzer(new NodeFileProvider(), runtime);
  analyzer.updateSettings({
    workspace: {
      ...analyzer.getSettings().workspace,
      maxFiles: 10_000,
      exclude: DEFAULT_EXCLUDES,
    },
  });
  analyzer.setWorkspaceRoots(moduleRoots.map(pathToUri));
  return { analyzer, runtime };
}

function hostBindings(hostRoots: readonly string[]) {
  return hostRoots.flatMap((hostRoot) => {
    const bridge = new HostTypeService(hostRoot);
    return bridge.ready() ? [...bridge.registeredOperations()] : [];
  });
}

function writeGeneratedDocs(docsRoot: string, sidebarPath: string, index: MettaDocIndex): void {
  rmSync(docsRoot, { recursive: true, force: true });
  mkdirSync(join(docsRoot, "modules"), { recursive: true });
  mkdirSync(join(docsRoot, "host"), { recursive: true });

  writeFileSync(join(docsRoot, "docs-index.json"), renderMettaDocsJson(index));
  writeFileSync(join(docsRoot, "index.md"), renderMettaDocsIndexPage(index));
  for (const module of index.modules) {
    const outPath = join(docsRoot, "modules", mettaModuleOutputPath(module));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, renderMettaModulePage(module));
  }
  for (const operation of index.hostOperations) {
    const outPath = join(docsRoot, "host", hostOperationOutputPath(operation));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, renderHostOperationPage(operation));
  }
  mkdirSync(dirname(sidebarPath), { recursive: true });
  writeFileSync(sidebarPath, renderMettaSidebarModule(index));
}

export async function generateMettaDocs(
  options: GenerateMettaDocsOptions,
): Promise<GenerateMettaDocsResult> {
  const moduleRoots = options.moduleRoots.map((root) => resolve(root));
  const hostRoots = options.hostRoots.map((root) => resolve(root));
  const { analyzer, runtime } = analyzerFor(moduleRoots);
  await analyzer.scanWorkspace();
  const bindings = hostBindings(hostRoots);
  const workspaceRootUri =
    moduleRoots.length === 1 ? pathToUri(moduleRoots[0] as string) : pathToUri(options.repoRoot);
  const draftIndex = buildMettaDocIndex({
    analyzer,
    runtime,
    workspaceRootUri,
    sourceRootUri: pathToUri(options.repoRoot),
    hostBindings: bindings,
  });
  const index = buildMettaDocIndex({
    analyzer,
    runtime,
    workspaceRootUri,
    sourceRootUri: pathToUri(options.repoRoot),
    hostBindings: bindings,
    generatedAt: generatedAtFor(options.docsRoot, draftIndex.sourceFingerprint),
  });
  writeGeneratedDocs(options.docsRoot, options.sidebarPath, index);
  const symbolCount = index.modules.reduce((sum, module) => sum + module.symbols.length, 0);
  return {
    index,
    docsRoot: options.docsRoot,
    sidebarPath: options.sidebarPath,
    moduleCount: index.modules.length,
    symbolCount,
    hostOperationCount: index.hostOperations.length,
  };
}
