// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Drive the MeTTa debug adapter with a scripted DAP client: launch a reduction, then step through it and
// check the current expression at each stop, ending in a terminated event. This exercises the adapter glue
// end to end (the stepping engine has its own unit tests).

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "metta-dap-"));
const program = join(dir, "prog.metta");
// `double` comes only from the imported module, so this also exercises cross-file debug via launch imports.
writeFileSync(program, "(import! &self mathmod)\n");

const adapter = spawn("node", ["dist/debug/mettaDebugAdapter.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

const events = [];
let buffer = Buffer.alloc(0);
adapter.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const match = /Content-Length: (\d+)/i.exec(buffer.slice(0, headerEnd).toString());
    const start = headerEnd + 4;
    const length = match ? Number(match[1]) : 0;
    if (buffer.length < start + length) break;
    if (match) events.push(JSON.parse(buffer.slice(start, start + length).toString()));
    buffer = buffer.slice(start + length);
  }
});

let seq = 0;
function send(command, args) {
  seq += 1;
  const body = JSON.stringify({ seq, type: "request", command, arguments: args });
  adapter.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

let cursor = 0;
async function waitFor(predicate, label) {
  const deadline = Date.now() + 5000;
  for (;;) {
    while (cursor < events.length) {
      const message = events[cursor++];
      if (predicate(message)) return message;
    }
    if (Date.now() > deadline) throw new Error(`DAP timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const isResponse = (command) => (m) => m.type === "response" && m.command === command;
const isEvent = (event) => (m) => m.type === "event" && m.event === event;

async function currentExpression() {
  send("stackTrace", { threadId: 1 });
  const response = await waitFor(isResponse("stackTrace"), "stackTrace");
  return response.body.stackFrames[0].name;
}

async function scopes() {
  send("scopes", { frameId: 1 });
  const response = await waitFor(isResponse("scopes"), "scopes");
  return response.body.scopes;
}

async function variables(variablesReference) {
  send("variables", { variablesReference });
  const response = await waitFor(isResponse("variables"), "variables");
  return response.body.variables;
}

function assert(condition, message) {
  if (!condition) {
    console.error(`dap smoke FAILED: ${message}`);
    adapter.kill();
    process.exit(1);
  }
}

async function main() {
  send("initialize", {
    clientID: "smoke",
    adapterID: "metta",
    pathFormat: "path",
    linesStartAt1: true,
    columnsStartAt1: true,
  });
  await waitFor(isEvent("initialized"), "initialized event");

  send("launch", {
    program,
    query: "(double 21)",
    imports: { mathmod: "(= (double $x) (* 2 $x))" },
  });
  const launched = await waitFor(isResponse("launch"), "launch response");
  assert(launched.success, "launch should succeed");
  await waitFor(isEvent("stopped"), "stopped at entry");
  assert((await currentExpression()) === "(double 21)", "entry expression should be (double 21)");
  const traceScope = (await scopes()).find((scope) => scope.name === "Trace");
  assert(traceScope !== undefined, "Trace scope should be present");
  const traceVariables = await variables(traceScope.variablesReference);
  assert(
    traceVariables.some((variable) => variable.name === "reductions" && Number(variable.value) > 0),
    "Trace scope should expose reduction count",
  );

  send("next", { threadId: 1 });
  await waitFor(isEvent("stopped"), "stopped after step 1");
  assert((await currentExpression()) === "(* 2 21)", "after one step should be (* 2 21)");

  send("next", { threadId: 1 });
  await waitFor(isEvent("stopped"), "stopped after step 2");
  assert((await currentExpression()) === "42", "after two steps should be 42");

  send("next", { threadId: 1 });
  await waitFor(isEvent("terminated"), "terminated at normal form");

  adapter.kill();
  console.log("dap smoke ok");
}

main().catch((error) => {
  console.error(`dap smoke error: ${error.message}`);
  adapter.kill();
  process.exit(1);
});
