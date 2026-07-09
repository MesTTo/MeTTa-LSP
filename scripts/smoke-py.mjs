// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Drive the built LSP server with a scripted stdio client and run a Python-using file through the
// unguarded metta/run path, end to end over real CPython: pythonia spawns python3, py-eval and an
// applied py-atom must reduce, and the result must report python: "live". When the backend is missing
// (pythonia not installed or python3 not on PATH) the smoke skips cleanly and says so, keeping the gate
// meaningful on machines without Python while never failing them.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const python3 = spawnSync("python3", ["--version"], { stdio: "ignore" }).status === 0;
let pythonia = true;
try {
  const { createRequire } = await import("node:module");
  createRequire(import.meta.url).resolve("pythonia");
} catch {
  pythonia = false;
}
if (!python3 || !pythonia) {
  console.log(
    `smoke-py: skipped (python3 ${python3 ? "found" : "missing"}, pythonia ${pythonia ? "found" : "missing"})`,
  );
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "metta-py-"));
const program = join(dir, "py.metta");
writeFileSync(program, '!(py-eval "6 * 7")\n!((py-atom operator.add) 40 2)\n');
const uri = `file://${program}`;

const server = spawn("node", ["dist/server/server.js", "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = Buffer.alloc(0);
const pending = new Map();
let nextId = 0;

function send(method, params, isNotification = false) {
  const message = { jsonrpc: "2.0", method, params };
  let promise = Promise.resolve();
  if (!isNotification) {
    nextId += 1;
    message.id = nextId;
    promise = new Promise((resolve) => pending.set(message.id, resolve));
  }
  const body = JSON.stringify(message);
  server.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  return promise;
}

server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.slice(0, headerEnd).toString())?.[1] ?? 0,
    );
    if (buffer.length < headerEnd + 4 + length) return;
    const body = JSON.parse(buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.slice(headerEnd + 4 + length);
    if (body.id !== undefined && pending.has(body.id)) {
      pending.get(body.id)(body.result);
      pending.delete(body.id);
    }
  }
});

const fail = (message) => {
  console.error(`smoke-py: FAIL — ${message}`);
  server.kill();
  process.exit(1);
};
const timeout = setTimeout(() => fail("timed out after 60s"), 60_000);

await send("initialize", {
  processId: process.pid,
  rootUri: `file://${dir}`,
  workspaceFolders: [{ uri: `file://${dir}`, name: "py-smoke" }],
  capabilities: {},
});
send("initialized", {}, true);
send(
  "textDocument/didOpen",
  {
    textDocument: {
      uri,
      languageId: "metta",
      version: 1,
      text: '!(py-eval "6 * 7")\n!((py-atom operator.add) 40 2)\n',
    },
  },
  true,
);

const result = await send("metta/run", { uri });
if (result?.python !== "live")
  fail(`expected python: "live", got ${JSON.stringify(result?.python)}`);
const flat = (result.queries ?? []).flatMap((query) => query.results);
if (!flat.includes("42")) fail(`expected a 42 in results, got ${JSON.stringify(flat)}`);
if ((result.queries ?? []).length !== 2) fail(`expected 2 queries, got ${result.queries?.length}`);

clearTimeout(timeout);
server.kill();
console.log(
  `smoke-py: ok — ${result.queries.map((q) => `${q.query} => [${q.results.join(",")}]`).join(" | ")}`,
);
process.exit(0);
