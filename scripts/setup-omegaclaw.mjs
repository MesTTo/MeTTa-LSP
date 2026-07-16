#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Install or remove the MeTTa-LSP OmegaClaw integration. OmegaClaw loads the external Python bridge through
// its plugin API. A small copied MeTTa wrapper and managed catalogue lines remain necessary because the
// upstream plugin API does not provide MeTTa skill registration.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = join(ROOT, "omegaclaw", "payload");
const PLUGIN_SOURCE = join(ROOT, "omegaclaw", "plugin");
const CLI = join(ROOT, "dist", "cli", "cli.js");
const RECEIPT_NAME = ".metta-lsp-omegaclaw-receipt.json";
const BACKUP_SUFFIX = ".metta-lsp-omegaclaw.bak";
const BEGIN = ";; >>> metta-lsp-omegaclaw (managed; do not edit by hand) >>>";
const END = ";; <<< metta-lsp-omegaclaw <<<";
const IMPORT_BLOCK_RE = /[ \t]*;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const SKILLS_BLOCK_RE = /\n[ \t]*;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const SKILL_DOC_BLOCK_RE = /\n;; >>> metta-lsp-omegaclaw.*?;; <<< metta-lsp-omegaclaw <<<\n/gs;
const PLUGIN_BEGIN = "# >>> metta-lsp-omegaclaw plugin (managed; do not edit by hand) >>>";
const PLUGIN_END = "# <<< metta-lsp-omegaclaw plugin <<<";
const PLUGIN_BLOCK_RE =
  /\n# >>> metta-lsp-omegaclaw plugin .*?# <<< metta-lsp-omegaclaw plugin <<<\n/gs;
const LIBOMEGA = "lib_omegaclaw.metta";
const SKILLS = "src/skills.metta";
const PLUGINS = "config/plugins.yaml";
const PLUGIN_RUNTIME = "src/plugin.py";
const PLUGIN_API = "src/pluginapi.py";
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
  '"- List the installed MeTTa standard library: metta-lsp-list-stdlib"',
  '"- Inspect a standard-library entry or module: metta-lsp-inspect name"',
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
      "  --force           overwrite MeTTa wrapper files not owned by a previous install",
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

function receiptEntries(receipt, key) {
  const entries = receipt?.[key];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) fail(`${RECEIPT_NAME}: ${key} must be an array.`);
  for (const [index, entry] of entries.entries()) {
    if (entry === null || typeof entry !== "object" || typeof entry.path !== "string")
      fail(`${RECEIPT_NAME}: ${key}[${index}].path must be a string.`);
  }
  return entries;
}

function receiptTargetPath(target, relPath, label) {
  if (typeof relPath !== "string" || relPath.length === 0)
    fail(`${RECEIPT_NAME}: ${label} must be a non-empty relative path.`);
  const candidate = resolve(target, relPath);
  const inside = relative(target, candidate);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    fail(`${RECEIPT_NAME}: ${label} escapes the OmegaClaw checkout: ${relPath}`);
  return candidate;
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

function stripPluginBlock(text) {
  return text.replace(PLUGIN_BLOCK_RE, "");
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

function pluginBlock() {
  return `\n${PLUGIN_BEGIN}\n- name: metta_lsp\n  loader: python\n  location: ${JSON.stringify(PLUGIN_SOURCE)}\n${PLUGIN_END}\n`;
}

function patchPlugins(text) {
  const clean = stripPluginBlock(text);
  if (/^\s*-\s*name:\s*["']?metta_lsp["']?\s*(?:#.*)?$/mu.test(clean)) return undefined;
  return clean + pluginBlock();
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

function inverseRegistryTransform(text) {
  const clean = stripSkillDocBlock(text);
  if (!clean.includes(SKILLS_OPEN_REPL) || !clean.includes(SKILLS_CLOSE_REPL)) return undefined;
  return clean
    .replace(SKILLS_OPEN_REPL, SKILLS_OPEN_ANCHOR)
    .replace(SKILLS_CLOSE_REPL, SKILLS_CLOSE_ANCHOR);
}

function patchSkills(text) {
  if (skillRegistry || hasOpenSkillRegistry(text)) return registryTransform(text);
  const clean = stripGetSkillsBlock(text);
  const close = findGetSkillsClose(clean);
  if (close === undefined) return undefined;
  return clean.slice(0, close) + getSkillsBlock() + clean.slice(close);
}

function payloadFiles() {
  return [["src/skills_metta_lsp.metta", join(PAYLOAD, "src", "skills_metta_lsp.metta")]];
}

function renderPayload(_relPath, srcPath) {
  return read(srcPath);
}

function backup(target, relPath, receipt) {
  const path = join(target, relPath);
  const backupPath = path + BACKUP_SUFFIX;
  if (!existsSync(backupPath)) writeFileSync(backupPath, read(path));
  receipt.backups.push({ path: relPath, backup: relative(target, backupPath) });
}

function validateTarget(target) {
  const required = [LIBOMEGA, SKILLS, PLUGINS, PLUGIN_RUNTIME, PLUGIN_API];
  const missing = required.filter((path) => !existsSync(join(target, path)));
  if (missing.length > 0)
    fail(`${target} does not expose the OmegaClaw plugin API. Missing ${missing.join(", ")}.`);
}

function validateInstallSource() {
  if (!existsSync(join(PLUGIN_SOURCE, "metta_lsp.py")))
    fail(`OmegaClaw plugin source missing: ${join(PLUGIN_SOURCE, "metta_lsp.py")}`);
  if (!existsSync(CLI)) fail(`Build first: ${CLI} does not exist (run npm run compile).`);
}

function loadReceipt(target) {
  const path = join(target, RECEIPT_NAME);
  if (!existsSync(path)) return undefined;
  try {
    const receipt = JSON.parse(read(path));
    if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt))
      fail(`${RECEIPT_NAME}: root must be an object.`);
    return receipt;
  } catch (error) {
    fail(
      `${RECEIPT_NAME}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function install(target) {
  validateTarget(target);
  validateInstallSource();
  const previous = loadReceipt(target);
  const previousCopies = receiptEntries(previous, "copied_files");
  const previousPatches = receiptEntries(previous, "patched_files");
  const receipt = {
    installed_at: new Date().toISOString(),
    lsp_root: ROOT,
    mode: skillRegistry ? "plugin-api+skill-registry" : "plugin-api+managed-splice",
    copied_files: [],
    patched_files: [],
    backups: [],
  };

  const libomegaText = patchLibomega(read(join(target, LIBOMEGA)));
  if (libomegaText === undefined) fail(`${LIBOMEGA}: import anchor not found.`);
  const skillsSource = read(join(target, SKILLS));
  const previousManagedSplice = previousPatches.some(
    (patch) => patch.path === SKILLS && patch.kind === "getskills-block",
  );
  // A managed getSkills splice sits inside the closed registry expression and splits its closing anchor.
  // Remove the owned block before converting that expression to the open skill-doc registry.
  const skillsPatchSource =
    skillRegistry && previousManagedSplice ? stripGetSkillsBlock(skillsSource) : skillsSource;
  const skillsWasOpen = hasOpenSkillRegistry(skillsPatchSource);
  const previouslyTransformedRegistry = previousPatches.some(
    (patch) =>
      patch.path === SKILLS &&
      (patch.kind === "skill-doc-registry-transform" ||
        (patch.kind === "skill-doc-registry" &&
          skillsPatchSource.includes(SKILLS_OPEN_REPL) &&
          skillsPatchSource.includes(SKILLS_CLOSE_REPL))),
  );
  const skillsText = patchSkills(skillsPatchSource);
  if (skillsText === undefined)
    fail(`${SKILLS}: getSkills or skill-doc registry anchors not found.`);
  const pluginsText = patchPlugins(read(join(target, PLUGINS)));
  if (pluginsText === undefined)
    fail(`${PLUGINS}: a metta_lsp plugin exists outside the managed block.`);

  const copies = payloadFiles().map(([relPath, srcPath]) => {
    if (!existsSync(srcPath)) fail(`payload file missing: ${srcPath}`);
    const dest = join(target, relPath);
    const body = renderPayload(relPath, srcPath);
    const ownedBefore = previousCopies.some((entry) => entry.path === relPath);
    if (existsSync(dest) && !ownedBefore && !force && read(dest) !== body) {
      fail(`${relPath} exists and is not owned by a previous install. Use --force to overwrite.`);
    }
    return { relPath, dest, body };
  });
  const currentCopyPaths = new Set(copies.map((copy) => copy.relPath));
  const obsoleteCopies = previousCopies.filter((entry) => !currentCopyPaths.has(entry.path));

  console.log(`MeTTa-LSP OmegaClaw plugin -> ${target}`);
  console.log(`  register ${join(PLUGIN_SOURCE, "metta_lsp.py")} in ${PLUGINS}`);
  console.log(`  copy ${copies.length} files`);
  if (obsoleteCopies.length > 0) console.log(`  remove ${obsoleteCopies.length} legacy files`);
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
  for (const file of obsoleteCopies)
    rmSync(receiptTargetPath(target, file.path, "copied_files.path"), { force: true });
  write(join(target, PLUGINS), pluginsText);
  receipt.patched_files.push({ path: PLUGINS, kind: "plugin-block" });
  backup(target, LIBOMEGA, receipt);
  write(join(target, LIBOMEGA), libomegaText);
  receipt.patched_files.push({ path: LIBOMEGA, kind: "import-block" });
  backup(target, SKILLS, receipt);
  write(join(target, SKILLS), skillsText);
  receipt.patched_files.push({
    path: SKILLS,
    kind: hasOpenSkillRegistry(skillsText)
      ? !skillsWasOpen || previouslyTransformedRegistry
        ? "skill-doc-registry-transform"
        : "skill-doc-block"
      : "getskills-block",
  });
  write(join(target, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`installed; receipt ${join(target, RECEIPT_NAME)}`);
}

function uninstallTarget(target) {
  validateTarget(target);
  const receipt = loadReceipt(target);
  if (receipt === undefined) fail(`no ${RECEIPT_NAME} found in ${target}`);
  console.log(`Removing MeTTa-LSP OmegaClaw integration from ${target}`);
  if (dryRun) {
    console.log("dry-run: no files removed");
    return;
  }

  const patches = receiptEntries(receipt, "patched_files");
  const copiedFiles = receiptEntries(receipt, "copied_files");
  const backups = receiptEntries(receipt, "backups");
  const writes = [];
  for (const patch of patches) {
    const path = receiptTargetPath(target, patch.path, "patched_files.path");
    if (patch.kind === "skill-doc-registry-transform") {
      const transformed = inverseRegistryTransform(read(path));
      if (transformed === undefined)
        fail(`${patch.path}: managed skill registry anchors changed; refusing a lossy uninstall.`);
      writes.push({ path, text: transformed });
    } else if (patch.kind === "skill-doc-block") {
      writes.push({ path, text: stripSkillDocBlock(read(path)) });
    } else if (patch.kind === "skill-doc-registry") {
      // Receipts written by earlier installer versions did not distinguish a converted registry from one
      // that was already open. Inspect the managed scaffold to choose the lossless inverse.
      const current = read(path);
      if (current.includes(SKILLS_OPEN_REPL) && current.includes(SKILLS_CLOSE_REPL)) {
        const transformed = inverseRegistryTransform(current);
        if (transformed === undefined)
          fail(
            `${patch.path}: managed skill registry anchors changed; refusing a lossy uninstall.`,
          );
        writes.push({ path, text: transformed });
      } else if (hasOpenSkillRegistry(current)) {
        writes.push({ path, text: stripSkillDocBlock(current) });
      } else {
        fail(`${patch.path}: managed skill registry anchors changed; refusing a lossy uninstall.`);
      }
    } else if (patch.kind === "import-block") {
      writes.push({ path, text: stripImportBlock(read(path)) });
    } else if (patch.kind === "getskills-block") {
      writes.push({ path, text: stripGetSkillsBlock(read(path)) });
    } else if (patch.kind === "plugin-block") {
      writes.push({ path, text: stripPluginBlock(read(path)) });
    } else {
      fail(`${RECEIPT_NAME}: unsupported patch kind ${String(patch.kind)}.`);
    }
  }
  for (const file of copiedFiles) receiptTargetPath(target, file.path, "copied_files.path");
  for (const entry of backups) {
    const backup =
      typeof entry.backup === "string" ? entry.backup : `${entry.path}${BACKUP_SUFFIX}`;
    receiptTargetPath(target, backup, "backups.backup");
  }

  for (const entry of writes) writeFileSync(entry.path, entry.text);
  for (const file of copiedFiles) {
    rmSync(receiptTargetPath(target, file.path, "copied_files.path"), { force: true });
  }
  for (const file of copiedFiles) {
    const dir = dirname(receiptTargetPath(target, file.path, "copied_files.path"));
    if (dir !== target) {
      try {
        rmSync(dir, { recursive: false });
      } catch {
        // Directory still has files from OmegaClaw or another extension.
      }
    }
  }
  rmSync(join(target, RECEIPT_NAME), { force: true });
  for (const entry of backups) {
    const backup =
      typeof entry.backup === "string" ? entry.backup : `${entry.path}${BACKUP_SUFFIX}`;
    rmSync(receiptTargetPath(target, backup, "backups.backup"), { force: true });
  }
  console.log("uninstalled");
}

if (targetArg === undefined) usage();
const target = resolve(targetArg);
if (uninstall) uninstallTarget(target);
else install(target);
