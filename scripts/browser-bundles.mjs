// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forbidden = new Set([...builtinModules, ...builtinModules.map((module) => `node:${module}`)]);

async function bundle(entryPoint, outfile, options = {}) {
  const result = await esbuild.build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: [entryPoint],
    format: "esm",
    logLevel: "warning",
    metafile: true,
    outfile,
    platform: "browser",
    sourcemap: true,
    target: "es2022",
    ...options,
  });
  for (const [input, metadata] of Object.entries(result.metafile.inputs)) {
    if (forbidden.has(input)) throw new Error(`${outfile} pulled forbidden browser input ${input}`);
    for (const imported of metadata.imports) {
      if (forbidden.has(imported.path)) {
        throw new Error(`${outfile} pulled forbidden browser import ${imported.path}`);
      }
    }
  }
}

export async function bundleBrowserArtifacts({ client, serverDir, runtimeDir, minify = false }) {
  if (client) {
    await bundle("src/client/browserExtension.ts", client, { external: ["vscode"], minify });
  }
  await Promise.all([
    bundle("src/server/browserServer.ts", path.join(serverDir, "browserServer.js"), { minify }),
    bundle(
      "src/runtime/browserEvaluationWorker.ts",
      path.join(runtimeDir, "browserEvaluationWorker.js"),
      { minify },
    ),
    bundle(
      "src/runtime/browserSemanticLintWorker.ts",
      path.join(runtimeDir, "browserSemanticLintWorker.js"),
      { minify },
    ),
    bundle(
      "src/runtime/browserHyperposeWorker.ts",
      path.join(runtimeDir, "browserHyperposeWorker.js"),
      { minify },
    ),
  ]);
}

export { repositoryRoot };
