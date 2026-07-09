// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Smoke test the built plugin bundle: it must load as CommonJS, export the tsserver factory function, and the
// factory must return a plugin module with a create() method. This proves the bundle is self-contained (no
// missing require at load) and shaped the way tsserver expects. The behavior of create() is covered by the
// vitest end-to-end integration test.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const init = require("../typescript-plugin/dist/index.js");

if (typeof init !== "function") {
  throw new Error(`plugin bundle must export a factory function, got ${typeof init}`);
}
const pluginModule = init({ typescript: ts });
if (typeof pluginModule?.create !== "function") {
  throw new Error("plugin factory must return an object with a create() method");
}

// create() must run against the bundle (so the bundled adapter and decorator actually construct) and return a
// decorated language service that exposes our adapted methods. A minimal stub info is enough: the decorator
// only wires the proxy here, it does not touch the language service until a request arrives.
// The decorator binds every method it adapts off the base service, so the stub must expose each as a
// function; a no-op proxy answers any method access.
const languageService = new Proxy({}, { get: () => () => undefined });
const project = {
  getScriptInfo: () => undefined,
  getLanguageService: () => languageService,
};
const decorated = pluginModule.create({
  languageService,
  project,
  config: {},
  serverHost: {},
});
if (typeof decorated?.getSemanticDiagnostics !== "function") {
  throw new Error("create() must return a decorated language service with getSemanticDiagnostics");
}

console.log("ts-plugin smoke ok");
