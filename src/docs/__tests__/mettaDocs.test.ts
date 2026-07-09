// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The MeTTa API reference is generated from the same sources the editor uses: Analyzer indexes, get-doc
// records, `;;` doc comments, and HostTypeService bindings. These tests cover the in-memory graph behavior
// and the committed site output drift guard.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CoreRuntime, pathToUri } from "../../language-service/index.js";
import { NodeFileProvider } from "../../runtime/nodeFileProvider.js";
import { Analyzer } from "../../server/analyzer.js";
import type { HostBinding } from "../../server/bridge/hostBridge.js";
import { HostTypeService } from "../../server/bridge/hostTypeService.js";
import { InMemoryFileProvider } from "../../server/fileProvider.js";
import {
  buildMettaDocIndex,
  hostOperationOutputPath,
  mettaModuleOutputPath,
  renderHostOperationPage,
  renderMettaDocsIndexPage,
  renderMettaDocsJson,
  renderMettaModulePage,
  renderMettaSidebarModule,
} from "../mettaDocs.js";

const ZERO_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

function fixtureHostBinding(): HostBinding {
  return {
    name: "host-add",
    kind: "operation",
    signature: {
      label: "(left: number, right: number): number",
      params: [
        { name: "left", tsType: "number", mettaType: "Number", optional: false, rest: false },
        { name: "right", tsType: "number", mettaType: "Number", optional: false, rest: false },
      ],
      returnTsType: "number",
      returnMettaType: "Number",
      mettaArrow: "(-> Number Number Number)",
      documentation: "Adds two host-side numbers.",
    },
    definition: { uri: pathToUri("/ws/host.ts"), range: ZERO_RANGE },
    origin: "host.ts",
  };
}

async function fixtureIndex() {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile(
    "/ws/math.metta",
    [
      '(@doc square (@desc "Squares a number") (@params ((@param "the input"))) (@return "the square"))',
      "(: square (-> Number Number))",
      ";; fallback docs that should lose to @doc",
      "(= (square $x) (* $x $x))",
      ";; Adds through the TypeScript bridge.",
      "(: host-add (-> Number Number Number))",
      "(= (host-add $x $y) (+ $x $y))",
    ].join("\n"),
  );
  files.writeFile("/ws/lint.metta", "(lint-rule no-op)");
  const runtime = new CoreRuntime();
  const analyzer = new Analyzer(files, runtime);
  analyzer.setWorkspaceRoots([pathToUri("/ws")]);
  await analyzer.scanWorkspace();
  return buildMettaDocIndex({
    analyzer,
    runtime,
    workspaceRootUri: pathToUri("/ws"),
    sourceRootUri: pathToUri("/ws"),
    hostBindings: [fixtureHostBinding()],
  });
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function actualDocsIndex() {
  const root = repoRoot();
  const examples = join(root, "examples");
  const committedIndex = JSON.parse(
    readFileSync(join(root, "docs-site/reference/metta/docs-index.json"), "utf8"),
  ) as { generatedAt: string };
  const runtime = new CoreRuntime();
  const analyzer = new Analyzer(new NodeFileProvider(), runtime);
  analyzer.updateSettings({
    workspace: {
      ...analyzer.getSettings().workspace,
      maxFiles: 10_000,
      exclude: [
        "node_modules",
        ".git",
        "dist",
        "out",
        ".venv",
        "__pycache__",
        ".metta-lsp-cache",
        "docs-site/.vitepress/dist",
      ],
    },
  });
  analyzer.setWorkspaceRoots([pathToUri(examples)]);
  await analyzer.scanWorkspace();
  const bridge = new HostTypeService(examples);
  return buildMettaDocIndex({
    analyzer,
    runtime,
    workspaceRootUri: pathToUri(examples),
    sourceRootUri: pathToUri(root),
    hostBindings: bridge.ready() ? bridge.registeredOperations() : [],
    generatedAt: committedIndex.generatedAt,
  });
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walkFiles(full));
    else files.push(full);
  }
  return files;
}

describe("MeTTa docs index", () => {
  it("uses @doc over fallback comments and merges type declarations with definitions", async () => {
    const index = await fixtureIndex();
    expect(index.modules.map((module) => module.name)).toEqual(["math"]);
    const module = index.modules[0];
    expect(module?.sourceUri).toBe("math.metta");
    expect(module?.symbols.map((symbol) => symbol.name).sort()).toEqual(["host-add", "square"]);
    const square = module?.symbols.find((symbol) => symbol.name === "square");
    expect(square?.doc?.description).toBe("Squares a number");
    expect(square?.fallbackDoc).toBeNull();
    expect(square?.type).toBe("(-> Number Number)");
  });

  it("attaches TypeScript host operation docs to matching MeTTa symbols", async () => {
    const index = await fixtureIndex();
    const operation = index.hostOperations[0];
    expect(operation).toMatchObject({
      name: "host-add",
      slug: "host-add",
      mettaType: "(-> Number Number Number)",
      sourcePath: "host.ts",
      definitionUri: "host.ts",
    });
    const symbol = index.modules[0]?.symbols.find((entry) => entry.name === "host-add");
    expect(symbol?.hostOperation).toBe("host-add");
  });

  it("renders module, host, and sidebar pages from the JSON graph", async () => {
    const index = await fixtureIndex();
    const modulePage = renderMettaModulePage(index.modules[0]!);
    expect(modulePage).toContain("Squares a number");
    expect(modulePage).toContain("Host operation: [`host-add`](../host/host-add)");
    const hostPage = renderHostOperationPage(index.hostOperations[0]!);
    expect(hostPage).toContain('"host-add"(left: number, right: number): number;');
    const sidebar = renderMettaSidebarModule(index);
    expect(sidebar).toContain("/reference/metta/modules/math");
    expect(renderMettaDocsIndexPage(index)).toContain("Source fingerprint:");
    const parsed = JSON.parse(renderMettaDocsJson(index)) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it("keeps the committed generated docs byte-identical to a fresh render", async () => {
    const root = repoRoot();
    const docsRoot = join(root, "docs-site/reference/metta");
    const index = await actualDocsIndex();
    const expected = new Map<string, string>([
      ["docs-index.json", renderMettaDocsJson(index)],
      ["index.md", renderMettaDocsIndexPage(index)],
    ]);
    for (const module of index.modules)
      expected.set(join("modules", mettaModuleOutputPath(module)), renderMettaModulePage(module));
    for (const operation of index.hostOperations)
      expected.set(
        join("host", hostOperationOutputPath(operation)),
        renderHostOperationPage(operation),
      );

    const actualFiles = walkFiles(docsRoot)
      .map((file) => relative(docsRoot, file))
      .sort();
    expect(actualFiles).toEqual([...expected.keys()].sort());
    for (const [path, content] of expected)
      expect(readFileSync(join(docsRoot, path), "utf8")).toBe(content);
    expect(
      readFileSync(join(root, "docs-site/.vitepress/metta-sidebar.generated.ts"), "utf8"),
    ).toBe(renderMettaSidebarModule(index));
  });
});
