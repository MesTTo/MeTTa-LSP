// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the TypeScript language-service plugin into a single self-contained CommonJS file. It bundles the
// compiled embedded adapter (dist/embedded, produced by `npm run compile`) and the decorator, leaving only
// `typescript` external so the editor's own tsserver provides it. Run after `npm run compile`.
import { build } from "esbuild";

await build({
  entryPoints: ["typescript-plugin/index.ts"],
  outfile: "typescript-plugin/dist/index.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["typescript"],
  logLevel: "warning",
});

console.log("ts-plugin bundle written to typescript-plugin/dist/index.js");
