#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Install or remove the MeTTa-LSP OmegaClaw skill overlay. The integration lives
// in this repo. A user points the installer at their OmegaClaw-Core checkout, and
// the installer copies two bridge files plus reversible managed imports/catalogue
// lines into that checkout.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = join(ROOT, "omegaclaw", "payload");
const RECEIPT_NAME = ".metta-lsp-omegaclaw-receipt.json";
const BACKUP_SUFFIX = ".metta-lsp-omegaclaw.bak";
const BEGIN = ";; >>> metta-lsp-omegaclaw (managed; do not edit by hand) >>>";
const END = ";; <<< metta-lsp-omegaclaw <<<";
const IMPORT_BLOCK_RE = /[ \t]*;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const SKILLS_BLOCK_RE = /\n[ \t]*;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const SKILL_DOC_BLOCK_RE = /\n;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const LIBOMEGA = "lib_omegaclaw.metta";
const SKILLS = "src/skills.metta";
const LIBOMEGA_ANCHOR = "!(import! &self (library OmegaClaw-Core lib_pln))";
const SKILLS_IMPORT = "!(import! &self (library OmegaClaw-Core ./src/skills_metta_lsp))";
const SKILLS_OPEN_ANCHOR = "(= (getSkills)\n   (;INTERNAL:";
const SKILLS_OPEN_REPL = [
  "; Open skill catalogue (added by metta-lsp-omegaclaw --skill-registry).",
  "; Core lines live in skill-doc. Extension files advertise more skills by",
  '; adding (= (skill-doc) "- what it does: skill-name arg") equations.',
  "(= (skill-doc)\n   (superpose (;INTERNAL:",
].join("\n");
const SKILLS_CLOSE_ANCHOR = '(stv 1.0 0.9)))"))';
const SKILLS_CLOSE_REPL = '(stv 1.0 0.9)))")))\n\n(= (getSkills) (collapse (skill-doc)))';
const GETSKILLS_LINES = [
  '"- Check a MeTTa file with MeTTa-LSP diagnostics and lint: metta-lsp-check path"',
  '"- List document symbols in a MeTTa file: metta-lsp-symbols path"',
  '"- Run assert tests in a MeTTa file: metta-lsp-test path"',
  '"- Evaluate bang queries in a MeTTa file: metta-lsp-run path"',
  '"- Check whether a MeTTa file is formatted: metta-lsp-format-check path"',
  '"- Show hover docs/types at a position: metta-lsp-hover path line character"',
  '"- Find the definition at a position: metta-lsp-def path line character"',
  '"- Find references at a position: metta-lsp-refs path line character"',
  '"- Explain the form at a position as mixfix: metta-lsp-explain path line character"',
];

const args = process.argv.slice(2);
const targetArg = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const uninstall = args.includes("--uninstall");
const force = args.includes("--force");
const skillRegistry = args.includes("--skill-registry");

function usage() {
  console.error(
    [
      "usage: node scripts/setup-omegaclaw.mjs /path/to/OmegaClaw-Core [--dry-run] [--force]",
      "       node scripts/setup-omegaclaw.mjs /path/to/OmegaClaw-Core --uninstall",
      "",
      "Options:",
      "  --skill-registry  rewrite closed getSkills into (collapse (skill-doc)) before registering",
      "  --dry-run         print the plan without writing",
      "  --force           overwrite payload files not owned by a previous install",
      "  --uninstall       remove the overlay using the receipt",
    ].join("\n"),
  );
  process.exit(2);
}

function fail(message) {
  console.error(`setup-omegaclaw: FAIL: ${message}`);
  process.exit(1);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function findGetSkillsClose(text) {
  const match = /\(=\s*\(getSkills\)/.exec(text);
  if (match === null) return undefined;
  let index = match.index + match[0].length;
  let depth = 1;
  let inString = false;
  let inComment = false;
  while (index < text.length) {
    const char = text[index];
    if (inComment) {
      if (char === "\n") inComment = false;
      index += 1;
    } else if (inString) {
      if (char === "\\") {
        index += 2;
      } else {
        if (char === '"') inString = false;
        index += 1;
      }
    } else if (char === '"') {
      inString = true;
      index += 1;
    } else if (char === ";") {
      inComment = true;
      index += 1;
    } else if (char === "(") {
      depth += 1;
      index += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 1) return index;
      if (depth === 0) return undefined;
      index += 1;
    } else {
      index += 1;
    }
  }
  return undefined;
}

function stripImportBlock(text) {
  return text.replace(IMPORT_BLOCK_RE, "");
}

function stripGetSkillsBlock(text) {
  return text.replace(SKILLS_BLOCK_RE, "");
}

function stripSkillDocBlock(text) {
  return text.replace(SKILL_DOC_BLOCK_RE, "");
}

function importBlock() {
  return `${BEGIN}\n${SKILLS_IMPORT}\n${END}\n`;
}

function getSkillsBlock() {
  const indent = "    ";
  return `\n${indent}${BEGIN}\n${GETSKILLS_LINES.map((line) => `${indent}${line}`).join("\n")}\n${indent}${END}\n`;
}

function skillDocBlock() {
  const equations = GETSKILLS_LINES.map((line) => `(= (skill-doc) ${line})`).join("\n");
  return `\n${BEGIN}\n${equations}\n${END}\n`;
}

function patchLibomega(text) {
  const clean = stripImportBlock(text);
  if (clean.includes(SKILLS_IMPORT)) return clean;
  const anchor = clean.indexOf(LIBOMEGA_ANCHOR);
  if (anchor < 0) return undefined;
  const endOfLine = clean.indexOf("\n", anchor) + 1;
  return clean.slice(0, endOfLine) + importBlock() + clean.slice(endOfLine);
}

function hasOpenSkillRegistry(text) {
  return /\(=\s*\(getSkills\)\s*\(\s*collapse\s*\(\s*skill-doc\s*\)\s*\)\s*\)/.test(text);
}

function registryTransform(text) {
  if (hasOpenSkillRegistry(text)) return stripSkillDocBlock(text) + skillDocBlock();
  if (!text.includes(SKILLS_OPEN_ANCHOR) || !text.includes(SKILLS_CLOSE_ANCHOR)) return undefined;
  const opened = text
    .replace(SKILLS_OPEN_ANCHOR, SKILLS_OPEN_REPL)
    .replace(SKILLS_CLOSE_ANCHOR, SKILLS_CLOSE_REPL);
  return stripSkillDocBlock(opened) + skillDocBlock();
}

function patchSkills(text) {
  if (skillRegistry || hasOpenSkillRegistry(text)) return registryTransform(text);
  const clean = stripGetSkillsBlock(text);
  const close = findGetSkillsClose(clean);
  if (close === undefined) return undefined;
  return clean.slice(0, close) + getSkillsBlock() + clean.slice(close);
}

function payloadFiles() {
  return [
    ["src/metta_lsp.py", join(PAYLOAD, "src", "metta_lsp.py")],
    ["src/skills_metta_lsp.metta", join(PAYLOAD, "src", "skills_metta_lsp.metta")],
  ];
}

function renderPayload(relPath, srcPath) {
  const text = read(srcPath);
  if (relPath === "src/metta_lsp.py") {
    return text.replace("__METTA_LSP_ROOT__", ROOT.replaceAll("\\", "\\\\"));
  }
  return text;
}

function backup(target, relPath, receipt) {
  const path = join(target, relPath);
  const backupPath = path + BACKUP_SUFFIX;
  if (!existsSync(backupPath)) writeFileSync(backupPath, read(path));
  receipt.backups.push({ path: relPath, backup: relative(target, backupPath) });
}

function validateTarget(target) {
  if (!existsSync(join(target, LIBOMEGA)) || !existsSync(join(target, SKILLS))) {
    fail(`${target} does not look like OmegaClaw-Core. Missing ${LIBOMEGA} or ${SKILLS}.`);
  }
}

function loadReceipt(target) {
  const path = join(target, RECEIPT_NAME);
  return existsSync(path) ? JSON.parse(read(path)) : undefined;
}

function install(target) {
  validateTarget(target);
  const previous = loadReceipt(target);
  const receipt = {
    installed_at: new Date().toISOString(),
    lsp_root: ROOT,
    mode: skillRegistry ? "skill-registry" : "managed-splice",
    copied_files: [],
    patched_files: [],
    backups: [],
  };

  const libomegaText = patchLibomega(read(join(target, LIBOMEGA)));
  if (libomegaText === undefined) fail(`${LIBOMEGA}: import anchor not found.`);
  const skillsText = patchSkills(read(join(target, SKILLS)));
  if (skillsText === undefined)
    fail(`${SKILLS}: getSkills or skill-doc registry anchors not found.`);

  const copies = payloadFiles().map(([relPath, srcPath]) => {
    if (!existsSync(srcPath)) fail(`payload file missing: ${srcPath}`);
    const dest = join(target, relPath);
    const body = renderPayload(relPath, srcPath);
    const ownedBefore = previous?.copied_files?.some((entry) => entry.path === relPath) ?? false;
    if (existsSync(dest) && !ownedBefore && !force && read(dest) !== body) {
      fail(`${relPath} exists and is not owned by a previous install. Use --force to overwrite.`);
    }
    return { relPath, dest, body };
  });

  console.log(`MeTTa-LSP OmegaClaw overlay -> ${target}`);
  console.log(`  copy ${copies.length} files`);
  console.log(`  patch ${LIBOMEGA}`);
  console.log(
    `  patch ${SKILLS} (${hasOpenSkillRegistry(skillsText) ? "skill-doc registry" : receipt.mode})`,
  );
  if (dryRun) {
    console.log("dry-run: no files written");
    return;
  }

  for (const { relPath, dest, body } of copies) {
    write(dest, body);
    receipt.copied_files.push({ path: relPath });
  }
  backup(target, LIBOMEGA, receipt);
  write(join(target, LIBOMEGA), libomegaText);
  receipt.patched_files.push({ path: LIBOMEGA, kind: "import-block" });
  backup(target, SKILLS, receipt);
  write(join(target, SKILLS), skillsText);
  receipt.patched_files.push({
    path: SKILLS,
    kind: hasOpenSkillRegistry(skillsText) ? "skill-doc-registry" : "getskills-block",
  });
  write(join(target, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`installed; receipt ${join(target, RECEIPT_NAME)}`);
}

function restoreBackup(target, relPath) {
  const path = join(target, relPath);
  const backupPath = path + BACKUP_SUFFIX;
  if (existsSync(backupPath)) {
    writeFileSync(path, read(backupPath));
    rmSync(backupPath);
    return true;
  }
  return false;
}

function uninstallTarget(target) {
  validateTarget(target);
  const receipt = loadReceipt(target);
  if (receipt === undefined) fail(`no ${RECEIPT_NAME} found in ${target}`);
  console.log(`Removing MeTTa-LSP OmegaClaw overlay from ${target}`);
  if (dryRun) {
    console.log("dry-run: no files removed");
    return;
  }

  for (const patch of receipt.patched_files ?? []) {
    const path = join(target, patch.path);
    if (patch.kind === "skill-doc-registry") {
      restoreBackup(target, patch.path);
    } else if (patch.kind === "import-block") {
      writeFileSync(path, stripImportBlock(read(path)));
    } else if (patch.kind === "getskills-block") {
      writeFileSync(path, stripGetSkillsBlock(read(path)));
    }
  }
  for (const file of receipt.copied_files ?? []) {
    rmSync(join(target, file.path), { force: true });
  }
  for (const file of receipt.copied_files ?? []) {
    const dir = dirname(join(target, file.path));
    if (dir !== target) {
      try {
        rmSync(dir, { recursive: false });
      } catch {
        // Directory still has files from OmegaClaw or another extension.
      }
    }
  }
  rmSync(join(target, RECEIPT_NAME), { force: true });
  for (const entry of receipt.backups ?? []) {
    rmSync(join(target, entry.backup ?? `${entry.path}${BACKUP_SUFFIX}`), { force: true });
  }
  console.log("uninstalled");
}

if (targetArg === undefined) usage();
const target = resolve(targetArg);
if (uninstall) uninstallTarget(target);
else install(target);
