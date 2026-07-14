// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the TypeScript language-service plugin into a single self-contained CommonJS file. It bundles the
// compiled embedded adapter (dist/embedded, produced by `npm run compile`) and the decorator, leaving only
// `typescript` external so the editor's own tsserver provides it. Run after `npm run compile`.

import { cpSync, existsSync, mkdirSync } from "node:fs";
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

// tsserver resolves a contributed plugin by name against <extension>/node_modules, so the built bundle has
// to exist at node_modules/metta-ts-typescript-plugin/dist/index.js in the VSIX or the plugin silently
// fails to load. install-links=true (.npmrc) packs the file: dep into a real directory there, but npm packs
// at install time, before this bundle is built, so that copy has no dist. Mirror it in after the build.
const installed = "node_modules/metta-ts-typescript-plugin";
if (existsSync(installed)) {
  mkdirSync(`${installed}/dist`, { recursive: true });
  cpSync("typescript-plugin/dist/index.js", `${installed}/dist/index.js`);
  console.log(`ts-plugin bundle mirrored to ${installed}/dist/index.js`);
}
