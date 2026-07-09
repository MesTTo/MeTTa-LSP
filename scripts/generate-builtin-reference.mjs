// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Regenerates docs-site/reference/builtins.md from the builtin catalog and the interpreter's own get-doc.
// Run with `npm run docs:builtins` after `npm run compile`. The rendering lives in
// dist/docs/builtinReference.js so it is unit-tested and shared with the drift guard; this script only wires
// the catalog and the runtime to it and writes the file.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBuiltinReference } from "../dist/docs/builtinReference.js";
import { CoreRuntime } from "../dist/language-service/coreRuntime.js";
import { allBuiltinDefinitions } from "../dist/server/builtins.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "docs-site/reference/builtins.md");

const runtime = new CoreRuntime();
let enriched = 0;
const entries = allBuiltinDefinitions().map((def) => {
  const result = runtime.getDoc("", def.name);
  const doc = result.isErr() ? null : result.value;
  if (doc !== null) enriched += 1;
  return { def, doc };
});

writeFileSync(outPath, renderBuiltinReference(entries));
console.log(
  `Wrote ${outPath}: ${entries.length} builtins, ${enriched} enriched via get-doc, ${entries.length - enriched} from the catalog.`,
);
