// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the VS Code Web client, browser LSP server, and browser runtime workers. The browser artifacts must
// not rely on Node module loading or Node builtins; esbuild's browser platform catches most bad imports, and
// the post-build scan fails on any remaining builtin references in the emitted files.

import { builtinModules } from "node:module";
import * as esbuild from "esbuild";

const forbidden = new Set([...builtinModules, ...builtinModules.map((module) => `node:${module}`)]);

async function bundle(options) {
  const result = await esbuild.build({
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    metafile: true,
    logLevel: "warning",
    ...options,
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    if (forbidden.has(input)) {
      throw new Error(`${options.outfile} pulled forbidden browser input ${input}`);
    }
  }
}

await bundle({
  entryPoints: ["src/client/browserExtension.ts"],
  external: ["vscode"],
  outfile: "dist/client/browserExtension.js",
});

await bundle({
  entryPoints: ["src/server/browserServer.ts"],
  outfile: "dist/server/browserServer.js",
});

await bundle({
  entryPoints: ["src/runtime/browserEvaluationWorker.ts"],
  outfile: "dist/runtime/browserEvaluationWorker.js",
});

await bundle({
  entryPoints: ["src/runtime/browserSemanticLintWorker.ts"],
  outfile: "dist/runtime/browserSemanticLintWorker.js",
});

await bundle({
  entryPoints: ["src/runtime/browserHyperposeWorker.ts"],
  outfile: "dist/runtime/browserHyperposeWorker.js",
});

console.log("browser bundles written to dist/client, dist/server, and dist/runtime");
