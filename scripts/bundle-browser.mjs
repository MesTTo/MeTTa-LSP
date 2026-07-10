// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Bundle the VS Code Web client, browser LSP server, and browser runtime workers. The browser artifacts must
// not rely on Node module loading or Node builtins; esbuild's browser platform catches most bad imports, and
// the post-build scan fails on any remaining builtin references in the emitted files.

import path from "node:path";
import { bundleBrowserArtifacts, repositoryRoot } from "./browser-bundles.mjs";

await bundleBrowserArtifacts({
  client: path.join(repositoryRoot, "dist/client/browserExtension.js"),
  serverDir: path.join(repositoryRoot, "dist/server"),
  runtimeDir: path.join(repositoryRoot, "dist/runtime"),
});

console.log("browser bundles written to dist/client, dist/server, and dist/runtime");
