// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Regenerates the VitePress MeTTa API reference from the language server's own analyzer, interpreter docs,
// and TypeScript host-operation bridge.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultMettaDocsOptions,
  generateMettaDocs,
  parseRootList,
} from "../dist/docs/mettaDocsGenerator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = defaultMettaDocsOptions(root);
const result = await generateMettaDocs({
  ...defaults,
  moduleRoots: parseRootList(root, process.env.METTA_DOCS_ROOTS, "examples"),
  hostRoots: parseRootList(root, process.env.METTA_DOCS_HOST_ROOTS, "examples"),
});

console.log(
  `Wrote ${result.docsRoot}: ${result.moduleCount} modules, ${result.symbolCount} symbols, ${result.hostOperationCount} host operations.`,
);
