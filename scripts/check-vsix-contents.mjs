#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/@vscode/vsce/vsce", "ls", "--readme-path", "EXTENSION.md"],
  { encoding: "utf8" },
);

if (result.error) {
  process.stderr.write(`Unable to inspect VSIX contents: ${result.error.message}\n`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const files = result.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const fileSet = new Set(files);

const required = [
  "package.json",
  "EXTENSION.md",
  "CHANGELOG.md",
  "LICENSE",
  "dist/client/extension.cjs",
  "dist/server/server.js",
  "dist/server/browserServer.js",
  "node_modules/@metta-ts/browser/package.json",
  "node_modules/@metta-ts/core/package.json",
  "node_modules/@metta-ts/grapher/package.json",
  "node_modules/@metta-ts/hyperon/package.json",
  "node_modules/@metta-ts/node/package.json",
  "node_modules/@metta-ts/prolog/package.json",
  "node_modules/@metta-ts/py/package.json",
  "node_modules/pythonia/package.json",
  // contributes.typescriptServerPlugins names this plugin, and tsserver resolves it against
  // <extension>/node_modules. Without the built bundle at exactly this path the contribution dangles and
  // the plugin dies silently, which a VSIX that packages cleanly will not otherwise tell you.
  "node_modules/metta-ts-typescript-plugin/dist/index.js",
  "syntaxes/metta.tmLanguage.json",
  "snippets/metta.json",
  "language-configuration.json",
  "icon.png",
];

const forbidden = [
  /^\.alloy\//,
  /^\.github\//,
  /^\.eslintcache$/,
  /^bench\//,
  /^docs\//,
  /^docs-site\//,
  /^emacs\//,
  /^omegaclaw\//,
  /^skills\//,
  /^scripts\//,
  /^src\//,
  /^test\//,
  /^examples\//,
  /^todo\.md$/,
  /^package-lock\.json$/,
  /^tsconfig/,
  /^.*\.config\.ts$/,
  /^biome\.json$/,
  /^jscpd\.json$/,
  /^knip\.json$/,
  /^quality-guard\.json$/,
  /^dist\/.*\.map$/,
  /^dist\/.*\/__tests__\//,
  /^dist\/.*\/__fixtures__\//,
  /^node_modules\/.*\/__pycache__\//,
  /^node_modules\/.*\.pyc$/,
  /^typescript-plugin\/index\.ts$/,
];

const missing = required.filter((file) => !fileSet.has(file));
const blocked = files.filter((file) => forbidden.some((pattern) => pattern.test(file)));

if (missing.length > 0 || blocked.length > 0) {
  if (missing.length > 0) {
    process.stderr.write(
      `Missing required VSIX files:\n${missing.map((f) => `  - ${f}`).join("\n")}\n`,
    );
  }
  if (blocked.length > 0) {
    process.stderr.write(`Forbidden VSIX files:\n${blocked.map((f) => `  - ${f}`).join("\n")}\n`);
  }
  process.exit(1);
}

process.stdout.write(`VSIX content check passed (${files.length} files).\n`);
