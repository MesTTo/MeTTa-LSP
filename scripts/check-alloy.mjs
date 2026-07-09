#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Runs the Alloy models under models/ headless and asserts every `check` command is UNSAT. No
// counterexample means the invariant holds. Locates the Alloy analyzer jar via $ALLOY_JAR or the cached
// .alloy/ copy, downloading the pinned release on demand. Skips cleanly when Java is unavailable, and fails
// loudly when a check goes SAT.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOY_VERSION = "6.2.0";
const ALLOY_URL = `https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v${ALLOY_VERSION}/org.alloytools.alloy.dist.jar`;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modelsDir = join(repoRoot, "models");
const alloyDir = join(repoRoot, ".alloy");
const jarPath = process.env.ALLOY_JAR ?? join(alloyDir, "org.alloytools.alloy.dist.jar");

function hasJava() {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function ensureJar() {
  if (existsSync(jarPath)) return;
  console.log(`alloy: downloading analyzer ${ALLOY_VERSION} ...`);
  mkdirSync(alloyDir, { recursive: true });
  const response = await fetch(ALLOY_URL);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  writeFileSync(jarPath, Buffer.from(await response.arrayBuffer()));
}

// Parse `exec` stdout lines like "01. check EpochIndependence   0   1/1   SAT" into { name, verdict }.
function parseChecks(stdout) {
  const results = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*\d+\.\s+check\s+(\S+)\b.*?\b(SAT|UNSAT)\s*$/.exec(line);
    if (match) results.push({ name: match[1], verdict: match[2] });
  }
  return results;
}

function runModel(model) {
  const outDir = join(alloyDir, "out");
  // The per-command SAT/UNSAT summary is written to stderr; capture both streams.
  const result = spawnSync("java", ["-jar", jarPath, "exec", "-f", "-o", outDir, model], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`alloy exec failed for ${model}: ${result.stderr || result.stdout}`);
  }
  return parseChecks(`${result.stdout}\n${result.stderr}`);
}

async function main() {
  if (!hasJava()) {
    console.log("alloy: SKIPPED (no java on PATH; set up a JVM to run the model checks)");
    return;
  }
  await ensureJar();
  const models = readdirSync(modelsDir).filter((name) => name.endsWith(".als"));
  if (models.length === 0) throw new Error(`no .als models in ${modelsDir}`);

  let failed = 0;
  let checked = 0;
  for (const model of models) {
    const results = runModel(join(modelsDir, model));
    if (results.length === 0) throw new Error(`${model}: no check commands ran`);
    for (const { name, verdict } of results) {
      checked += 1;
      const ok = verdict === "UNSAT";
      console.log(
        `alloy: ${model} :: ${name} -> ${verdict} ${ok ? "(holds)" : "(COUNTEREXAMPLE)"}`,
      );
      if (!ok) failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`alloy: ${failed} invariant(s) violated`);
    process.exit(1);
  }
  console.log(`alloy: ${checked} invariant check(s) hold`);
}

main().catch((error) => {
  console.error(`alloy: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
