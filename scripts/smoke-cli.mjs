#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Process-level checks for CLI dispatch, machine-readable stdlib output, documentation workspace roots, and
// closed-pipe behavior. Unit tests own catalog details; this script proves the compiled entry point wires them.

import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli", "cli.js");

function fail(message) {
  process.stderr.write(`smoke-cli: FAIL: ${message}\n`);
  process.exit(1);
}

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) fail(`${args.join(" ")}: ${result.error.message}`);
  if (result.status !== expectedStatus)
    fail(
      `${args.join(" ")}: expected exit ${expectedStatus}, got ${result.status ?? "null"}\n${result.stderr}`,
    );
  return result;
}

function json(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const help = run(["--help"]).stdout;
if (!help.includes("list stdlib [--json]") || !help.includes("inspect <name> [--json]"))
  fail("help does not advertise stdlib discovery");

const listed = json(run(["list", "--json", "stdlib"]).stdout, "list stdlib");
if (listed.collection !== "stdlib" || listed.counts?.entries !== listed.entries?.length)
  fail("list stdlib counts do not match its entries");
if (!listed.modules?.some((module) => module.name === "json"))
  fail("list stdlib omitted the json module");
if (!listed.modules?.some((module) => module.name === "vector"))
  fail("list stdlib omitted the vector module");

const plus = json(run(["inspect", "--json", "+"]).stdout, "inspect +");
if (
  plus.inspection?.qualifiedName !== "global::+" ||
  plus.inspection?.description !== "Sums two numbers"
)
  fail("inspect + did not return the interpreter documentation");

const ambiguous = json(run(["inspect", "transaction", "--json"], 2).stderr, "ambiguous inspect");
if (ambiguous.error?.code !== "stdlib.ambiguous")
  fail("ambiguous inspect returned the wrong error");

const unknown = json(run(["inspect", "json-encod", "--json"], 1).stderr, "unknown inspect");
if (
  unknown.error?.code !== "stdlib.unknown" ||
  !unknown.error?.suggestions?.includes("json-encode")
)
  fail("unknown inspect did not return a useful suggestion");

const docs = json(run(["doc", "examples", "--json"]).stdout, "doc examples");
if (docs.modules < 1 || docs.symbols < 1) fail("doc examples did not index the workspace root");

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, "list", "stdlib"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.once("data", () => {
    child.stdout.destroy();
  });
  child.once("error", reject);
  child.once("close", (code) => {
    if (code !== 0) reject(new Error(`closed pipe exited ${code ?? "null"}: ${stderr}`));
    else if (stderr.includes("EPIPE")) reject(new Error(`closed pipe printed EPIPE: ${stderr}`));
    else resolve();
  });
}).catch((error) => fail(error instanceof Error ? error.message : String(error)));

process.stderr.write(
  "smoke-cli: ok - help, stdlib list/inspect, errors, docs root, and closed pipe pass\n",
);
