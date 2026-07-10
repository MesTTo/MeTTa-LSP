// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import path from "node:path";
import { bundleBrowserArtifacts, repositoryRoot } from "./browser-bundles.mjs";

const outputRoot = path.join(repositoryRoot, "docs-site/public/browser-ide");

await bundleBrowserArtifacts({
  serverDir: path.join(outputRoot, "server"),
  runtimeDir: path.join(outputRoot, "runtime"),
  minify: true,
});

console.log("browser IDE workers written to docs-site/public/browser-ide");
