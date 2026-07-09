#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The analyzer builds its data-position table by probing the interpreter at module load; that probe evaluates
// stdlib forms, some of which (trace!, println!, print!) write to the console. For a language server over
// stdio the console is the JSON-RPC channel, so importing the analyzer must not print anything — a stray byte
// corrupts the protocol at startup. This guards against that regression.

const chunks = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  chunks.push(typeof chunk === "string" ? chunk : String(chunk));
  return true;
};

await import("../dist/server/analyzer.js");

process.stdout.write = originalWrite;
const captured = chunks.join("");
if (captured.length > 0) {
  process.stderr.write(
    `smoke-no-stdout: FAIL — importing the analyzer wrote to stdout: ${JSON.stringify(captured)}\n`,
  );
  process.exit(1);
}
process.stderr.write("smoke-no-stdout: ok — analyzer import is stdout-clean\n");
