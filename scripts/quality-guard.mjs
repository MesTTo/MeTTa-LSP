// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Forbidden-pattern quality gate. Reads quality-guard.json and fails on any error-severity match.
// A fast, dependency-free belt-and-suspenders check alongside ESLint and Biome; run in CI and pre-commit.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, "quality-guard.json");
const GLOBAL_IGNORE = new Set(["node_modules", "dist", "out", "coverage", ".git", ".turbo"]);

/** Convert a glob (supporting ** and *) to a RegExp anchored against a repo-relative POSIX path. */
function globToRegExp(glob) {
  let re = "";
  const g = glob.replaceAll("\\", "/");
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        i += 1;
        if (g[i + 1] === "/") {
          i += 1;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (GLOBAL_IGNORE.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const generated = new Set((config.generated_files ?? []).map((p) => p.replaceAll("\\", "/")));
const files = walk(ROOT, []).filter((file) => file !== CONFIG_PATH);

let errors = 0;
let warnings = 0;

for (const rule of config.rules) {
  const extensions = rule.extensions === undefined ? null : new Set(rule.extensions);
  const excludes = (rule.exclude_paths ?? []).map(globToRegExp);
  const flags = [...new Set(`${rule.flags ?? ""}g`.split(""))].join("");

  for (const file of files) {
    if (extensions !== null && !extensions.has(extname(file))) continue;
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (generated.has(rel)) continue;
    if (excludes.some((r) => r.test(rel))) continue;

    const content = readFileSync(file, "utf8");
    const pattern = new RegExp(rule.pattern, flags);
    let match = pattern.exec(content);
    while (match !== null) {
      const line = content.slice(0, match.index).split("\n").length;
      const severity = rule.severity ?? "error";
      process.stdout.write(
        `${severity.toUpperCase()} [${rule.id}] ${rel}:${line}  ${rule.message}  -> ${rule.fix_hint}\n`,
      );
      if (severity === "error") {
        errors += 1;
      } else {
        warnings += 1;
      }
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
      match = pattern.exec(content);
    }
  }
}

process.stdout.write(`\nquality-guard: ${errors} error(s), ${warnings} warning(s)\n`);
process.exit(errors > 0 ? 1 : 0);
