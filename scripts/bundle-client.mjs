// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the extension client into a single CommonJS file. VS Code's extension host still loads extension
// entry points as CommonJS (microsoft/vscode#135450 is open), so the ESM `dist/client/extension.js` that tsc
// emits cannot be the `main`. esbuild bundles it — pulling in vscode-languageclient and the relative imports,
// with `vscode` left external — into `dist/client/extension.cjs`. The language server and debug adapter run
// as their own node processes, so they stay ESM and are unaffected.

import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["dist/client/extension.js"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["vscode"],
  outfile: "dist/client/extension.cjs",
  logLevel: "warning",
});

console.log("client bundle written to dist/client/extension.cjs");
