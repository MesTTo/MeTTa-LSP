#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Verify `setup-mcp.mjs --project=DIR` writes a project .mcp.json that registers the metta-lsp server, is
// idempotent, and merges into an existing file without clobbering other servers. This is the project-scoped
// setup a MeTTa workspace uses to get the LSP alongside the global Claude Code / Codex registrations. OmegaClaw
// uses scripts/setup-omegaclaw.mjs instead because it exposes skills through its own MeTTa getSkills catalogue.
// Runs in smoke:all, after compile, so dist/mcp/server.js exists.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const setup = join(dirname(fileURLToPath(import.meta.url)), "setup-mcp.mjs");
const dir = mkdtempSync(join(tmpdir(), "metta-mcp-"));
const mcpPath = join(dir, ".mcp.json");
const run = () => execFileSync("node", [setup, `--project=${dir}`], { encoding: "utf8" });

function fail(message) {
  process.stderr.write(`smoke-setup-mcp: FAIL — ${message}\n`);
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

run();
if (!existsSync(mcpPath)) fail("no .mcp.json written");
let config = JSON.parse(readFileSync(mcpPath, "utf8"));
if (!config.mcpServers?.["metta-lsp"]) fail("metta-lsp not registered");

// Add a second server, re-run, and confirm both survive (idempotent + non-clobbering merge).
config.mcpServers.other = { command: "x", args: [] };
writeFileSync(mcpPath, JSON.stringify(config, null, 2));
run();
config = JSON.parse(readFileSync(mcpPath, "utf8"));
if (!config.mcpServers.other || !config.mcpServers["metta-lsp"])
  fail("a re-run clobbered a server");

rmSync(dir, { recursive: true, force: true });
process.stderr.write("smoke-setup-mcp: ok — --project writes, is idempotent, and merges\n");
