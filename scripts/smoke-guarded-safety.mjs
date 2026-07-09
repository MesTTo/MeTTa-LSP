// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Prove the capability boundary behaviourally, through the real worker threads (vitest cannot resolve the
// worker file, so this lives as a smoke). The guarded worker runs untrusted code — hover previews, MCP — and
// must touch neither the filesystem nor git, even though fileio and git-import! are core grounded ops: it
// disables the host capability. The unguarded run is the user's explicit "run this file", so it keeps the
// capability and really does act. This pins both halves.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGuarded, evaluateUnguarded } from "../dist/runtime/guardedEvaluation.js";

const dir = mkdtempSync(join(tmpdir(), "metta-safety-"));
const repo = join(dir, "srcrepo");
execFileSync("git", ["init", "-q", repo]);
writeFileSync(join(repo, "x.metta"), "(= (x) 1)\n");
execFileSync("git", ["-C", repo, "add", "-A"]);
execFileSync("git", [
  "-C",
  repo,
  "-c",
  "user.email=x@x",
  "-c",
  "user.name=x",
  "commit",
  "-qm",
  "init",
]);

const cwd = mkdtempSync(join(tmpdir(), "metta-safety-cwd-"));
process.chdir(cwd);

function fail(message) {
  console.error(`guarded-safety smoke FAILED: ${message}`);
  rmSync(dir, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
  process.exit(1);
}

// Guarded: an untrusted program must not be able to write a file or clone a repo.
const probe = join(cwd, "probe-written");
await evaluateGuarded({
  source: `!(import! &self fileio)\n!(file-open! "${probe}" "cwt")`,
  wrapBareExpression: false,
});
if (existsSync(probe)) fail("guarded file-open! wrote a file");

await evaluateGuarded({ source: `!(git-import! "${repo}")`, wrapBareExpression: false });
if (existsSync(join(cwd, "repos", "srcrepo"))) fail("guarded git-import! cloned a repo");

// Unguarded: the explicit run keeps the host capability, so the same file IO really writes.
const probe2 = join(cwd, "probe-unguarded");
await evaluateUnguarded({
  source: `!(import! &self fileio)\n!(file-open! "${probe2}" "cwt")`,
  wrapBareExpression: false,
});
if (!existsSync(probe2)) fail("unguarded file-open! did not write — host effects should be on");

rmSync(dir, { recursive: true, force: true });
rmSync(cwd, { recursive: true, force: true });
console.log("guarded-safety smoke ok — guarded worker writes/clones nothing; unguarded run acts");
