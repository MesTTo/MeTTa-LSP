#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Smoke-test the OmegaClaw installer against throwaway clones. This validates the
// reversible patch shape without touching a real OmegaClaw checkout.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const setup = join(dirname(fileURLToPath(import.meta.url)), "setup-omegaclaw.mjs");
const tempRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "ai-tmp");
const stockLib = [
  "!(import! &self (library OmegaClaw-Core lib_nal))",
  "!(import! &self (library OmegaClaw-Core lib_pln))",
  "!(import! &self (library OmegaClaw-Core ./src/skills))",
  "",
].join("\n");
const stockSkills = [
  "(= (getSkills)",
  "   (;INTERNAL:",
  '    "- Remember a particular string such as skills and memories: remember string"',
  '    "metta (|~ ((Implication (Inheritance $1 (IntSet Feathered))"',
  '    "           (Inheritance $1 Bird)) (stv 1.0 0.9))"',
  '    "          ((Inheritance Pingu (IntSet Feathered)) (stv 1.0 0.9)))"))',
  "",
].join("\n");

function fail(message, dir) {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  process.stderr.write(`smoke-omegaclaw: FAIL: ${message}\n`);
  process.exit(1);
}

function makeClone() {
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "omegaclaw-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "lib_omegaclaw.metta"), stockLib);
  writeFileSync(join(dir, "src", "skills.metta"), stockSkills);
  return dir;
}

function run(dir, flags = []) {
  return execFileSync("node", [setup, dir, ...flags], { encoding: "utf8" });
}

function hasPython3() {
  try {
    return spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function assertManagedInstall(dir) {
  run(dir);
  run(dir);
  const lib = readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8");
  const skills = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  const py = readFileSync(join(dir, "src", "metta_lsp.py"), "utf8");
  if (!lib.includes("skills_metta_lsp")) fail("lib_omegaclaw import missing", dir);
  if ((lib.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("import block not idempotent", dir);
  if (!skills.includes("metta-lsp-check path")) fail("getSkills catalogue lines missing", dir);
  if ((skills.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("getSkills block not idempotent", dir);
  if (py.includes("__METTA_LSP_ROOT__")) fail("bridge root placeholder not replaced", dir);
  if (!existsSync(join(dir, ".metta-lsp-omegaclaw-receipt.json"))) fail("receipt missing", dir);
  if (hasPython3()) {
    const bridgeProbe = execFileSync(
      "python3",
      [
        "-c",
        [
          "import sys",
          `sys.path.insert(0, ${JSON.stringify(join(dir, "src"))})`,
          "import metta_lsp",
          'print(metta_lsp.cli("capabilities"))',
        ].join("; "),
      ],
      { encoding: "utf8" },
    );
    if (!bridgeProbe.includes("lsp_hover"))
      fail("Python bridge did not reach the MeTTa-LSP CLI", dir);
  } else {
    process.stderr.write("smoke-omegaclaw: SKIP Python bridge probe (python3 not on PATH)\n");
  }
  run(dir, ["--uninstall"]);
  if (readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8") !== stockLib)
    fail("lib not restored", dir);
  if (readFileSync(join(dir, "src", "skills.metta"), "utf8") !== stockSkills)
    fail("skills not restored", dir);
  if (existsSync(join(dir, "src", "metta_lsp.py"))) fail("bridge file not removed", dir);
}

function assertRegistryInstall(dir) {
  run(dir, ["--skill-registry"]);
  run(dir, ["--skill-registry"]);
  const skills = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  if (!skills.includes("(= (getSkills) (collapse (skill-doc)))"))
    fail("registry getSkills missing", dir);
  if (!skills.includes('(= (skill-doc) "- Check a MeTTa file'))
    fail("skill-doc equations missing", dir);
  if ((skills.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("registry block not idempotent", dir);
  run(dir, ["--uninstall"]);
  if (readFileSync(join(dir, "src", "skills.metta"), "utf8") !== stockSkills)
    fail("registry not restored", dir);
}

const managed = makeClone();
assertManagedInstall(managed);
rmSync(managed, { recursive: true, force: true });

const registry = makeClone();
assertRegistryInstall(registry);
rmSync(registry, { recursive: true, force: true });

process.stderr.write(
  "smoke-omegaclaw: ok - install, bridge, idempotency, registry mode, and uninstall pass\n",
);
