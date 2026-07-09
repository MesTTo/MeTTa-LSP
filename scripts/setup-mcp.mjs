#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Register the MeTTa MCP server with an agent, or print the config to paste yourself. The MCP server is
// the built stdio process `node dist/mcp/server.js`; it exposes the `lsp` tool (goToDefinition, hover,
// findReferences, …) and takes its workspace from the client's working directory.
//
//   node scripts/setup-mcp.mjs                 # print snippets for Claude Code, Codex, and generic clients
//   node scripts/setup-mcp.mjs --claude        # register with Claude Code + install the metta-lsp skill
//   node scripts/setup-mcp.mjs --codex         # add [mcp_servers."metta-lsp"] to ~/.codex/config.toml
//   node scripts/setup-mcp.mjs --all           # both
//   node scripts/setup-mcp.mjs --project=DIR    # register in DIR/.mcp.json for one MCP-aware project,
//                                               # not the global config
//
// Every apply is idempotent: an existing registration is left alone. Set CODEX_CONFIG to point --codex at
// a different config file (used by the tests).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "metta-lsp";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(root, "dist", "mcp", "server.js");
const command = "node";
const args = [serverPath];

if (!existsSync(serverPath)) {
  console.error(`Build first: ${serverPath} does not exist (run npm run compile).`);
  process.exit(1);
}

const flags = new Set(process.argv.slice(2));
const wantClaude = flags.has("--claude") || flags.has("--all");
const wantCodex = flags.has("--codex") || flags.has("--all");
const projectDir = (process.argv.slice(2).find((a) => a.startsWith("--project=")) ?? "").slice(
  "--project=".length,
);

function which(bin) {
  try {
    execFileSync("command", ["-v", bin], { shell: "/bin/sh", stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupClaude() {
  if (!which("claude")) {
    console.log(
      `claude CLI not found. Register manually:\n  claude mcp add -s user ${NAME} -- ${command} ${args.join(" ")}`,
    );
    return;
  }
  let existing = "";
  try {
    existing = execFileSync("claude", ["mcp", "list"], { encoding: "utf8" });
  } catch {
    // `claude mcp list` may fail if no servers are configured yet; treat as none.
  }
  if (existing.includes(NAME)) {
    console.log(`Claude Code: ${NAME} already registered — leaving it.`);
    return;
  }
  execFileSync("claude", ["mcp", "add", "-s", "user", NAME, "--", command, ...args], {
    stdio: "inherit",
  });
  console.log(`Claude Code: registered ${NAME}.`);
}

function codexSection() {
  return `\n[mcp_servers."${NAME}"]\ncommand = "${command}"\nargs = [${args.map((a) => JSON.stringify(a)).join(", ")}]\nstartup_timeout_sec = 120.0\n`;
}

function setupCodex() {
  const configPath = process.env.CODEX_CONFIG ?? join(homedir(), ".codex", "config.toml");
  const current = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (current.includes(`[mcp_servers."${NAME}"]`) || current.includes(`[mcp_servers.${NAME}]`)) {
    console.log(`Codex: ${NAME} already in ${configPath} — leaving it.`);
    return;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, current + codexSection());
  console.log(`Codex: added ${NAME} to ${configPath}.`);
}

// Install the metta-lsp skill so a Claude Code agent knows to reach for the LSP's intelligence on .metta
// code. Overwritten on each apply so it tracks the installed version; the skill is a shipped artifact, not
// a user config.
function installSkill() {
  const src = join(root, "skills", "metta-lsp", "SKILL.md");
  if (!existsSync(src)) {
    console.log("Skill source skills/metta-lsp/SKILL.md not found — skipping skill install.");
    return;
  }
  const destDir = join(homedir(), ".claude", "skills", "metta-lsp");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "SKILL.md"), readFileSync(src, "utf8"));
  console.log(`Claude Code: installed the metta-lsp skill to ${join(destDir, "SKILL.md")}.`);
}

// Register the server for a single MCP-aware project via a .mcp.json at its root, the config Claude Code,
// Cursor, and other MCP clients read inside that project. OmegaClaw is not an MCP client; use
// scripts/setup-omegaclaw.mjs for its MeTTa skill surface. Idempotent: an existing entry is left alone; a
// malformed file is not overwritten.
function setupProject(dir) {
  const target = resolve(dir);
  if (!existsSync(target)) {
    console.error(`Project: ${target} does not exist.`);
    return;
  }
  const mcpPath = join(target, ".mcp.json");
  let config = { mcpServers: {} };
  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpPath, "utf8"));
      config = { ...parsed, mcpServers: { ...(parsed.mcpServers ?? {}) } };
    } catch {
      console.error(`Project: ${mcpPath} is not valid JSON — leaving it.`);
      return;
    }
  }
  if (config.mcpServers[NAME]) {
    console.log(`Project: ${NAME} already in ${mcpPath} — leaving it.`);
    return;
  }
  config.mcpServers[NAME] = { command, args };
  writeFileSync(mcpPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Project: added ${NAME} to ${mcpPath}.`);
}

function printSnippets() {
  console.log(`# MeTTa MCP server: ${command} ${args.join(" ")}\n`);
  console.log(`## Claude Code\n  claude mcp add -s user ${NAME} -- ${command} ${args.join(" ")}\n`);
  console.log(`## Codex — ~/.codex/config.toml${codexSection()}`);
  console.log(`## Generic MCP client (mcp.json / Claude Desktop / Cursor)`);
  console.log(JSON.stringify({ mcpServers: { [NAME]: { command, args } } }, null, 2));
  console.log(`\nApply automatically: node scripts/setup-mcp.mjs --claude --codex`);
}

if (wantClaude) {
  installSkill();
  setupClaude();
}
if (wantCodex) setupCodex();
if (projectDir) setupProject(projectDir);
if (!wantClaude && !wantCodex && !projectDir) printSnippets();
