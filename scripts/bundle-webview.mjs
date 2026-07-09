// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the visualise webview into one browser IIFE. The webview hosts the same interactive MeTTaGrapher
// the metta-ts site embeds; @metta-ts/grapher, @metta-ts/hyperon, and gifenc are pure TypeScript/JS, so the
// whole editor-and-engine ships as a single script the webview loads with no network access.

import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/client/webview/visualiseMain.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: "dist/webview/visualise.js",
  logLevel: "warning",
});

console.log("webview bundle written to dist/webview/visualise.js");
