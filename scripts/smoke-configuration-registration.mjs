#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver-protocol/node";

const serverPath = fileURLToPath(new URL("../dist/server/server.js", import.meta.url));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function withTimeout(promise, label, timeoutMs = 10_000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runScenario(name, capabilities, expectedRegistration) {
  const server = spawn(process.execPath, [serverPath, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr = [];
  server.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  const connection = createMessageConnection(
    new StreamMessageReader(server.stdout),
    new StreamMessageWriter(server.stdin),
  );
  const ready = deferred();
  const registration = deferred();
  const exited = deferred();
  const registeredMethods = [];
  let shuttingDown = false;

  connection.onRequest("workspace/configuration", ({ items }) => items.map(() => ({})));
  connection.onRequest("client/registerCapability", ({ registrations }) => {
    for (const item of registrations) registeredMethods.push(item.method);
    registration.resolve();
    return null;
  });
  connection.onNotification("window/logMessage", ({ message }) => {
    if (message.includes("ready")) ready.resolve();
  });
  connection.onError((error) => ready.reject(error));
  server.once("error", (error) => ready.reject(error));
  server.once("exit", (code, signal) => {
    exited.resolve();
    if (!shuttingDown)
      ready.reject(
        new Error(
          `server exited with code ${code}, signal ${signal ?? "none"}: ${stderr.join("")}`,
        ),
      );
  });
  connection.listen();

  try {
    await connection.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      workspaceFolders: [],
      capabilities,
      clientInfo: { name },
    });
    connection.sendNotification("initialized", {});
    await withTimeout(ready.promise, `${name} server readiness`);
    if (expectedRegistration)
      await withTimeout(registration.promise, `${name} dynamic registration`);

    assert.deepEqual(
      registeredMethods,
      expectedRegistration ? ["workspace/didChangeConfiguration"] : [],
    );

    shuttingDown = true;
    await withTimeout(connection.sendRequest("shutdown"), `${name} shutdown`, 2_000);
    connection.sendNotification("exit");
    await withTimeout(exited.promise, `${name} exit`, 2_000);
  } finally {
    connection.dispose();
    if (server.exitCode === null) server.kill();
  }
}

await runScenario("eglot-like", { workspace: { configuration: true } }, false);
await runScenario(
  "dynamic-registration",
  {
    workspace: {
      configuration: true,
      didChangeConfiguration: { dynamicRegistration: true },
    },
  },
  true,
);

process.stderr.write("smoke-configuration-registration: ok\n");
