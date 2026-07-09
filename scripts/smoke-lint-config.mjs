// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Smoke-check the Biome + ESLint split: ESLint owns the type-aware and architecture rules, Biome owns
// formatting, import organization, and the stdio-safe no-console guard.

import { readFileSync } from "node:fs";

const eslint = readFileSync(new URL("../eslint.config.ts", import.meta.url), "utf8");
const eslintMarkers = [
  "defineConfig",
  "strictTypeChecked",
  "projectService:",
  "import-x/no-nodejs-modules",
  "boundaries/dependencies",
  "neverthrow/must-use-result",
  "strict-boolean-expressions",
  "switch-exhaustiveness-check",
  "no-import-type-side-effects",
];
for (const marker of eslintMarkers) {
  if (!eslint.includes(marker)) throw new Error(`eslint config missing marker: ${marker}`);
}

const biome = readFileSync(new URL("../biome.json", import.meta.url), "utf8");
for (const marker of ["organizeImports", "noConsole"]) {
  if (!biome.includes(marker)) throw new Error(`biome config missing marker: ${marker}`);
}

console.error("strict lint config smoke ok");
