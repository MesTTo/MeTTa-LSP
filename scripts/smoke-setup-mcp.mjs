#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Verify project registration and isolated Claude Code and Codex setup. The agent setup must install the whole
// skill directory, remain idempotent, and avoid touching the machine's real configuration.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const setup = join(dirname(fileURLToPath(import.meta.url)), "setup-mcp.mjs");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = join(root, "ai-tmp");
mkdirSync(tempRoot, { recursive: true });
const dir = mkdtempSync(join(tempRoot, "metta-mcp-"));
const mcpPath = join(dir, ".mcp.json");
const runProject = () =>
  execFileSync(process.execPath, [setup, `--project=${dir}`], { encoding: "utf8" });

function fail(message) {
  process.stderr.write(`smoke-setup-mcp: FAIL — ${message}\n`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

runProject();
if (!existsSync(mcpPath)) fail("no .mcp.json written");
let config = JSON.parse(readFileSync(mcpPath, "utf8"));
if (!config.mcpServers?.["metta-lsp"]) fail("metta-lsp not registered");

// Add a second server, re-run, and confirm both survive (idempotent + non-clobbering merge).
config.mcpServers.other = { command: "x", args: [] };
writeFileSync(mcpPath, JSON.stringify(config, null, 2));
runProject();
config = JSON.parse(readFileSync(mcpPath, "utf8"));
if (!config.mcpServers.other || !config.mcpServers["metta-lsp"])
  fail("a re-run clobbered a server");

const claudeRoot = join(dir, "claude");
const codexRoot = join(dir, "codex");
const codexConfig = join(codexRoot, "config.toml");
const isolatedEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: claudeRoot,
  CODEX_HOME: codexRoot,
  // setup-mcp launches through the absolute process.execPath. Hiding PATH prevents a real claude CLI from
  // receiving an MCP registration during this isolated smoke test.
  PATH: "",
};
const runAgents = () =>
  execFileSync(process.execPath, [setup, "--all"], { encoding: "utf8", env: isolatedEnv });

runAgents();
const firstConfig = readFileSync(codexConfig, "utf8");
runAgents();
if (readFileSync(codexConfig, "utf8") !== firstConfig) fail("Codex setup is not idempotent");

const sourceSkill = join(root, "skills", "metta-lsp");
for (const agentRoot of [claudeRoot, codexRoot]) {
  const installed = join(agentRoot, "skills", "metta-lsp");
  for (const relativePath of ["SKILL.md", join("agents", "openai.yaml")]) {
    const source = readFileSync(join(sourceSkill, relativePath), "utf8");
    const destination = join(installed, relativePath);
    if (!existsSync(destination)) fail(`${relativePath} was not installed for ${agentRoot}`);
    if (readFileSync(destination, "utf8") !== source)
      fail(`${relativePath} differs from the shipped skill for ${agentRoot}`);
  }
}

rmSync(dir, { recursive: true, force: true });
process.stderr.write(
  "smoke-setup-mcp: ok - project config and isolated Claude Code and Codex skill setup pass\n",
);
