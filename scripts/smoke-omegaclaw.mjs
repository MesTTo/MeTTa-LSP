#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Exercise the OmegaClaw installer against synthetic checkouts that implement the public Python plugin
// loader contract. The smoke test never touches a real OmegaClaw checkout.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const setup = join(root, "scripts", "setup-omegaclaw.mjs");
const externalPlugin = join(root, "omegaclaw", "plugin", "metta_lsp.py");
const tempRoot = join(root, "ai-tmp");
const receiptName = ".metta-lsp-omegaclaw-receipt.json";
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
const stockPlugins = "# OmegaClaw plugins used by the smoke fixture.\n";
const stockOpenSkills = [
  '(= (skill-doc) "- Existing open-registry skill: existing-skill")',
  "(= (getSkills) (collapse (skill-doc)))",
  "",
].join("\n");

// This fixture follows OmegaClaw's public Python loader boundary: read plugins.yaml, load
// <location>/<name>.py, retain the module in _plugins, and call loadOmegaClawPlugin().
const stockPluginRuntime = `
import importlib.util
import pathlib
import pluginapi
import sys
import yaml

_REPO = pathlib.Path(__file__).parent.parent.resolve()
_plugins = {}

class PythonPlugin:
    def __init__(self, mod):
        self.mod = mod

def initPlugins():
    with open(_REPO / "config" / "plugins.yaml", "r") as stream:
        plugins = yaml.safe_load(stream)
    for plugin in plugins:
        name = plugin.get("name")
        if name in _plugins:
            raise RuntimeError(f"name '{name}' is not unique")
        if plugin.get("loader", "metta") != "python":
            raise RuntimeError("fixture supports only the public Python loader")
        location = pathlib.Path(plugin["location"].format(REPO=_REPO)).resolve()
        sys.path.append(str(location))
        modpath = location / f"{name}.py"
        spec = importlib.util.spec_from_file_location(name, modpath)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _plugins[name] = PythonPlugin(mod)
        if not hasattr(mod, "loadOmegaClawPlugin"):
            raise RuntimeError(f"No loadOmegaClawPlugin() function in {name}")
        mod.loadOmegaClawPlugin()
`;

function fail(message, dir) {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  process.stderr.write(`smoke-omegaclaw: FAIL: ${message}\n`);
  process.exit(1);
}

function makeClone(skills = stockSkills) {
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "omegaclaw-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "lib_omegaclaw.metta"), stockLib);
  writeFileSync(join(dir, "src", "skills.metta"), skills);
  writeFileSync(join(dir, "config", "plugins.yaml"), stockPlugins);
  writeFileSync(join(dir, "src", "plugin.py"), stockPluginRuntime);
  writeFileSync(join(dir, "src", "pluginapi.py"), "# Public API fixture.\n");
  return dir;
}

function run(dir, flags = []) {
  return execFileSync(process.execPath, [setup, dir, ...flags], { encoding: "utf8" });
}

function runFailure(dir, flags = []) {
  return spawnSync(process.execPath, [setup, dir, ...flags], { encoding: "utf8" });
}

function hasPythonPluginRuntime() {
  return spawnSync("python3", ["-c", "import yaml"], { stdio: "ignore" }).status === 0;
}

function assertPluginLoaded(dir) {
  if (!hasPythonPluginRuntime()) {
    process.stderr.write(
      "smoke-omegaclaw: SKIP Python plugin probe (python3 or PyYAML unavailable)\n",
    );
    return;
  }
  const probe = execFileSync(
    "python3",
    [
      "-c",
      [
        "import sys",
        `sys.path.insert(0, ${JSON.stringify(join(dir, "src"))})`,
        "import plugin",
        "plugin.initPlugins()",
        'bridge = plugin._plugins["metta_lsp"].mod',
        'print(bridge.cli("capabilities"))',
        'print(bridge.inspect("+"))',
        'print(bridge.hover("examples/01-hovers.metta", 22, 4))',
        "print(bridge.list_stdlib())",
      ].join("; "),
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  if (!probe.includes("lsp_hover")) fail("plugin bridge did not reach CLI capabilities", dir);
  if (!probe.includes("global::+")) fail("plugin bridge did not inspect a stdlib entry", dir);
  if (!probe.includes("factorial"))
    fail("plugin bridge did not accept three position arguments", dir);
  if (!probe.includes("MeTTa standard library and extensions"))
    fail("plugin bridge did not list the stdlib", dir);
  if (!probe.includes("json::json-encode") || probe.includes("[metta-lsp output truncated]"))
    fail("plugin bridge did not return the complete stdlib list", dir);
}

function assertManagedInstall(dir) {
  run(dir);
  const first = {
    lib: readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8"),
    skills: readFileSync(join(dir, "src", "skills.metta"), "utf8"),
    plugins: readFileSync(join(dir, "config", "plugins.yaml"), "utf8"),
  };
  run(dir);
  const lib = readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8");
  const skills = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  const wrapper = readFileSync(join(dir, "src", "skills_metta_lsp.metta"), "utf8");
  const plugins = readFileSync(join(dir, "config", "plugins.yaml"), "utf8");
  if (lib !== first.lib || skills !== first.skills || plugins !== first.plugins)
    fail("a repeated install changed managed files", dir);
  if (!lib.includes("skills_metta_lsp")) fail("lib_omegaclaw import missing", dir);
  if ((lib.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("import block not idempotent", dir);
  if (!skills.includes("metta-lsp-list-stdlib")) fail("stdlib skill lines missing", dir);
  if (!skills.includes("metta-lsp-inspect name")) fail("inspect skill line missing", dir);
  if (!wrapper.includes("(metta-lsp-hover $path $line $character)"))
    fail("hover wrapper does not match its advertised arguments", dir);
  if (skills.includes("./src/metta_lsp.py"))
    fail("MeTTa wrapper still imports a copied bridge", dir);
  if ((skills.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("getSkills block not idempotent", dir);
  if ((plugins.match(/>>> metta-lsp-omegaclaw plugin/g) ?? []).length !== 1)
    fail("plugin block not idempotent", dir);
  if (!plugins.includes(JSON.stringify(dirname(externalPlugin))))
    fail("plugins.yaml does not reference the external plugin directory", dir);
  if (existsSync(join(dir, "src", "metta_lsp.py"))) fail("Python bridge was copied", dir);
  if (!existsSync(join(dir, receiptName))) fail("receipt missing", dir);
  const receipt = JSON.parse(readFileSync(join(dir, receiptName), "utf8"));
  if (receipt.mode !== "plugin-api+managed-splice") fail("plugin API mode missing", dir);
  if (!receipt.patched_files.some((entry) => entry.kind === "plugin-block"))
    fail("plugin block missing from receipt", dir);
  assertPluginLoaded(dir);

  run(dir, ["--uninstall"]);
  if (readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8") !== stockLib)
    fail("lib not restored", dir);
  if (readFileSync(join(dir, "src", "skills.metta"), "utf8") !== stockSkills)
    fail("skills not restored", dir);
  if (readFileSync(join(dir, "config", "plugins.yaml"), "utf8") !== stockPlugins)
    fail("plugins.yaml not restored", dir);
  if (existsSync(join(dir, "src", "skills_metta_lsp.metta")))
    fail("MeTTa wrapper not removed", dir);
}

function assertRegistryInstall(dir) {
  run(dir, ["--skill-registry"]);
  run(dir, ["--skill-registry"]);
  const skills = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  const plugins = readFileSync(join(dir, "config", "plugins.yaml"), "utf8");
  if (!skills.includes("(= (getSkills) (collapse (skill-doc)))"))
    fail("registry getSkills missing", dir);
  if (!skills.includes('(= (skill-doc) "- Check a MeTTa file'))
    fail("skill-doc equations missing", dir);
  if ((skills.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("registry block not idempotent", dir);
  if ((plugins.match(/>>> metta-lsp-omegaclaw plugin/g) ?? []).length !== 1)
    fail("registry plugin block not idempotent", dir);
  const receipt = JSON.parse(readFileSync(join(dir, receiptName), "utf8"));
  if (receipt.mode !== "plugin-api+skill-registry") fail("registry plugin mode missing", dir);
  const userSkill = '(= (skill-doc) "- User-managed skill: user-skill")';
  writeFileSync(join(dir, "src", "skills.metta"), `${skills}\n${userSkill}\n`);
  run(dir, ["--uninstall"]);
  const restoredSkills = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  if (!restoredSkills.includes(userSkill)) fail("registry uninstall discarded a user edit", dir);
  if (!restoredSkills.includes("(= (getSkills)") || restoredSkills.includes("collapse (skill-doc)"))
    fail("registry scaffold not restored", dir);
  if (restoredSkills.includes(">>> metta-lsp-omegaclaw"))
    fail("managed registry block not removed", dir);
  if (readFileSync(join(dir, "config", "plugins.yaml"), "utf8") !== stockPlugins)
    fail("registry plugins.yaml not restored", dir);
}

function assertManagedToRegistryUpgrade(dir) {
  run(dir);
  const installed = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  const userSkill = '    "- User skill kept across registry migration: user-skill"';
  const edited = installed.replace(
    "(= (getSkills)\n   (;INTERNAL:",
    `(= (getSkills)\n   (;INTERNAL:\n${userSkill}`,
  );
  if (edited === installed) fail("managed upgrade fixture could not insert a user skill", dir);
  writeFileSync(join(dir, "src", "skills.metta"), edited);

  run(dir, ["--skill-registry"]);
  run(dir, ["--skill-registry"]);
  const migrated = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  if (!migrated.includes("(= (getSkills) (collapse (skill-doc)))"))
    fail("managed install did not migrate to the skill-doc registry", dir);
  if (!migrated.includes(userSkill)) fail("registry migration discarded a user skill", dir);
  if ((migrated.match(/>>> metta-lsp-omegaclaw/g) ?? []).length !== 1)
    fail("registry migration left duplicate managed blocks", dir);
  const receipt = JSON.parse(readFileSync(join(dir, receiptName), "utf8"));
  const skillsPatch = receipt.patched_files.find((entry) => entry.path === "src/skills.metta");
  if (skillsPatch?.kind !== "skill-doc-registry-transform")
    fail("registry migration did not record the reversible transform", dir);

  run(dir, ["--uninstall"]);
  const restored = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  if (!restored.includes(userSkill))
    fail("registry migration uninstall discarded a user skill", dir);
  if (!restored.includes("(= (getSkills)") || restored.includes("collapse (skill-doc)"))
    fail("registry migration uninstall did not restore the closed registry", dir);
  if (restored.includes(">>> metta-lsp-omegaclaw"))
    fail("registry migration uninstall left a managed block", dir);
}

function assertLegacyUpgrade(dir) {
  writeFileSync(join(dir, "src", "metta_lsp.py"), "# legacy copied bridge\n");
  writeFileSync(
    join(dir, receiptName),
    `${JSON.stringify(
      {
        copied_files: [{ path: "src/metta_lsp.py" }, { path: "src/skills_metta_lsp.metta" }],
        patched_files: [],
        backups: [],
      },
      null,
      2,
    )}\n`,
  );
  run(dir);
  if (existsSync(join(dir, "src", "metta_lsp.py"))) fail("legacy bridge not removed", dir);
  const receipt = JSON.parse(readFileSync(join(dir, receiptName), "utf8"));
  if (receipt.copied_files.some((entry) => entry.path === "src/metta_lsp.py"))
    fail("legacy bridge remained in receipt", dir);
}

function assertPreexistingRegistry(dir) {
  run(dir);
  const receipt = JSON.parse(readFileSync(join(dir, receiptName), "utf8"));
  const skillsPatch = receipt.patched_files.find((entry) => entry.path === "src/skills.metta");
  if (skillsPatch?.kind !== "skill-doc-block")
    fail("pre-existing registry was recorded as a converted registry", dir);
  const userSkill = '(= (skill-doc) "- User skill added after install: later-skill")';
  const installed = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  writeFileSync(join(dir, "src", "skills.metta"), `${installed}\n${userSkill}\n`);
  run(dir, ["--uninstall"]);
  const restored = readFileSync(join(dir, "src", "skills.metta"), "utf8");
  if (!restored.includes("Existing open-registry skill") || !restored.includes(userSkill))
    fail("pre-existing registry content was discarded", dir);
  if (!restored.includes("(= (getSkills) (collapse (skill-doc)))"))
    fail("pre-existing open registry was closed", dir);
  if (restored.includes(">>> metta-lsp-omegaclaw"))
    fail("managed block remained in pre-existing registry", dir);
}

function assertDryRun(dir) {
  run(dir, ["--dry-run"]);
  if (readFileSync(join(dir, "lib_omegaclaw.metta"), "utf8") !== stockLib)
    fail("dry-run changed lib", dir);
  if (readFileSync(join(dir, "config", "plugins.yaml"), "utf8") !== stockPlugins)
    fail("dry-run changed plugins.yaml", dir);
  if (existsSync(join(dir, receiptName))) fail("dry-run wrote a receipt", dir);
}

function assertPluginCollision(dir) {
  writeFileSync(
    join(dir, "config", "plugins.yaml"),
    `${stockPlugins}\n- name: metta_lsp\n  loader: python\n  location: "/other/plugin"\n`,
  );
  const result = runFailure(dir);
  if (result.status === 0) fail("unmanaged plugin collision was accepted", dir);
  if (!result.stderr.includes("outside the managed block"))
    fail("plugin collision did not explain the conflict", dir);
  if (existsSync(join(dir, receiptName))) fail("plugin collision wrote a receipt", dir);
}

function assertUnsafeReceipt(dir) {
  const outside = join(dirname(dir), `${basename(dir)}-outside.txt`);
  writeFileSync(outside, "keep\n");
  writeFileSync(
    join(dir, receiptName),
    `${JSON.stringify({ copied_files: [{ path: `../${basename(outside)}` }] })}\n`,
  );
  const result = runFailure(dir, ["--uninstall"]);
  if (result.status === 0) fail("receipt path traversal was accepted", dir);
  if (!result.stderr.includes("escapes the OmegaClaw checkout"))
    fail("unsafe receipt did not explain the rejected path", dir);
  if (!existsSync(outside) || readFileSync(outside, "utf8") !== "keep\n")
    fail("unsafe receipt removed a file outside the checkout", dir);
  rmSync(outside, { force: true });
}

function assertMalformedReceipt(dir) {
  writeFileSync(join(dir, receiptName), "{not-json\n");
  const result = runFailure(dir);
  if (result.status === 0) fail("malformed receipt was accepted", dir);
  if (!result.stderr.includes("invalid JSON")) fail("malformed receipt error is unclear", dir);
  if (readFileSync(join(dir, "config", "plugins.yaml"), "utf8") !== stockPlugins)
    fail("malformed receipt changed plugins.yaml", dir);
}

for (const [name, check, initialSkills] of [
  ["managed", assertManagedInstall],
  ["registry", assertRegistryInstall],
  ["managed-to-registry", assertManagedToRegistryUpgrade],
  ["legacy-upgrade", assertLegacyUpgrade],
  ["pre-existing-registry", assertPreexistingRegistry, stockOpenSkills],
  ["dry-run", assertDryRun],
  ["collision", assertPluginCollision],
  ["unsafe-receipt", assertUnsafeReceipt],
  ["malformed-receipt", assertMalformedReceipt],
]) {
  const dir = makeClone(initialSkills);
  try {
    check(dir);
  } catch (error) {
    fail(`${name}: ${error instanceof Error ? error.message : String(error)}`, dir);
  }
  rmSync(dir, { recursive: true, force: true });
}

process.stderr.write(
  "smoke-omegaclaw: ok - plugin loading, skills, idempotency, receipts, upgrade, collision, and uninstall pass\n",
);
