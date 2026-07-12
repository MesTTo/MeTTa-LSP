#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createBrowserLspHarness } from "../bench/browser-lsp-harness.mjs";
import { browserWorkerBuildId } from "./browser-worker-version.mjs";

const rootUri = "file:///metta-browser-workspace";
const mainUri = `${rootUri}/main.metta`;
const mathUri = `${rootUri}/math.metta`;
const lintUri = `${rootUri}/lint-case.metta`;
const dynamicUri = `${rootUri}/dynamic.metta`;
const laterUri = `${rootUri}/later.metta`;
const mainSource = `!(import! &self "math.metta")

(: answer (-> Number))
(= (answer)     (double 21))
!(answer)

(: broken (-> Number))
(= (broken) (double 10 20))`;
const mathSource = `(: double (-> Number Number))
(= (double $x) (* $x 2))`;
const lintSource = `(= (loop $x) (loop $x))`;
const dynamicSource = `!(import! &self "later.metta")
!(later)`;
const laterSource = `(: later (-> Number))
(= (later) 7)`;
const semanticTokenTypes = [
  "function",
  "macro",
  "type",
  "variable",
  "parameter",
  "property",
  "string",
  "number",
  "keyword",
  "operator",
  "comment",
  "mettaControlFlow",
  "mettaBinding",
  "mettaPattern",
  "mettaModule",
  "mettaTypeOperator",
  "mettaEvaluation",
  "mettaQuote",
  "mettaEffect",
  "mettaArithmeticOperator",
  "mettaComparisonOperator",
  "mettaLogicalOperator",
  "mettaMathFunction",
  "mettaCollectionFunction",
  "mettaPredicateFunction",
  "mettaAssertion",
];

const browserWorkerRoot = fileURLToPath(
  new URL("../docs-site/public/browser-ide/", import.meta.url),
);
const generatedWorkerVersion = await readFile(
  new URL("../docs-site/.vitepress/theme/browser-ide/worker-version.generated.ts", import.meta.url),
  "utf8",
);
const expectedWorkerBuildId = await browserWorkerBuildId(browserWorkerRoot);
assert.ok(
  generatedWorkerVersion.includes(
    `export const BROWSER_WORKER_BUILD_ID = "${expectedWorkerBuildId}";`,
  ),
  "Expected the browser page worker generation to match every deployed worker bundle",
);

function positionOf(source, needle, characterOffset = 0) {
  const offset = source.indexOf(needle);
  assert.notEqual(offset, -1, `Expected source to contain ${needle}`);
  const prefix = source.slice(0, offset + characterOffset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
}

function completionItems(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.items) ? result.items : [];
}

function locations(result) {
  if (result === null || result === undefined) return [];
  return Array.isArray(result) ? result : [result];
}

const workspace = new Map([
  [mainUri, mainSource],
  [mathUri, mathSource],
  [lintUri, lintSource],
  [dynamicUri, dynamicSource],
]);
const harness = createBrowserLspHarness(workspace, {
  rootUri,
  script: new URL("../docs-site/public/browser-ide/server/browserServer.js", import.meta.url),
  timeoutMs: 20_000,
});

try {
  const initialized = await harness.initialize({
    capabilities: {
      workspace: { workspaceFolders: true },
      textDocument: {
        completion: { completionItem: { snippetSupport: true } },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        semanticTokens: {
          formats: ["relative"],
          multilineTokenSupport: false,
          overlappingTokenSupport: false,
          requests: { full: true },
          tokenModifiers: [],
          tokenTypes: semanticTokenTypes,
        },
      },
    },
    initializationOptions: { diagnostics: { semanticLint: true } },
  });
  assert.equal(initialized.capabilities.hoverProvider, true);
  assert.equal(initialized.capabilities.documentFormattingProvider, true);

  const resolvedMainDiagnostics = harness.waitDiagnostics(mainUri, (items) =>
    items.some((diagnostic) => diagnostic.code === "call.arity"),
  );
  await harness.open(mainUri, mainSource);
  await harness.open(mathUri, mathSource);
  const diagnostics = await resolvedMainDiagnostics;
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.code === "call.arity"),
    `Expected call.arity diagnostic, got ${JSON.stringify(diagnostics)}`,
  );

  const semanticDiagnostics = harness.waitDiagnostics(lintUri, (items) =>
    items.some((diagnostic) => diagnostic.code === "missing-recursive-type"),
  );
  await harness.open(lintUri, lintSource);
  assert.ok(
    (await semanticDiagnostics).some((diagnostic) => diagnostic.code === "missing-recursive-type"),
    "Expected browser semantic lint worker diagnostics",
  );

  const unresolvedDynamic = await harness.open(dynamicUri, dynamicSource);
  assert.ok(
    unresolvedDynamic.some((diagnostic) => diagnostic.code === "import.unresolved"),
    "Expected the missing dynamic import to be unresolved",
  );
  workspace.set(laterUri, laterSource);
  await harness.open(laterUri, laterSource);
  const resolvedDynamic = harness.waitDiagnostics(
    dynamicUri,
    (items) => !items.some((diagnostic) => diagnostic.code === "import.unresolved"),
  );
  harness.notify("workspace/didChangeWatchedFiles", {
    changes: [{ uri: laterUri, type: 1 }],
  });
  assert.ok(
    !(await resolvedDynamic).some((diagnostic) => diagnostic.code === "import.unresolved"),
    "Expected the created import target to resolve",
  );

  harness.notify("textDocument/didClose", { textDocument: { uri: laterUri } });
  workspace.delete(laterUri);
  const unresolvedAgain = harness.waitDiagnostics(dynamicUri, (items) =>
    items.some((diagnostic) => diagnostic.code === "import.unresolved"),
  );
  harness.notify("workspace/didChangeWatchedFiles", {
    changes: [{ uri: laterUri, type: 3 }],
  });
  assert.ok(
    (await unresolvedAgain).some((diagnostic) => diagnostic.code === "import.unresolved"),
    "Expected the deleted import target to become unresolved",
  );

  const doublePosition = positionOf(mainSource, "double 21", 1);
  const hover = await harness.request("textDocument/hover", {
    textDocument: { uri: mainUri },
    position: doublePosition,
  });
  assert.notEqual(hover, null, "Expected hover information for double");

  const definition = await harness.request("textDocument/definition", {
    textDocument: { uri: mainUri },
    position: doublePosition,
  });
  assert.ok(
    locations(definition).some((location) => location.uri === mathUri),
    `Expected definition in math.metta, got ${JSON.stringify(definition)}`,
  );

  const references = await harness.request("textDocument/references", {
    textDocument: { uri: mainUri },
    position: doublePosition,
    context: { includeDeclaration: true },
  });
  assert.ok(locations(references).length >= 2, "Expected declaration and call references");

  const completion = await harness.request("textDocument/completion", {
    textDocument: { uri: mainUri },
    position: positionOf(mainSource, "double 21", 3),
  });
  assert.ok(
    completionItems(completion).some((item) => item.label === "double"),
    "Expected double completion",
  );

  const symbols = await harness.request("textDocument/documentSymbol", {
    textDocument: { uri: mainUri },
  });
  assert.ok(Array.isArray(symbols) && symbols.length > 0, "Expected document symbols");

  const formatting = await harness.request("textDocument/formatting", {
    textDocument: { uri: mainUri },
    options: { tabSize: 2, insertSpaces: true },
  });
  assert.ok(Array.isArray(formatting) && formatting.length > 0, "Expected formatting edits");

  const semanticTokens = await harness.request("textDocument/semanticTokens/full", {
    textDocument: { uri: mainUri },
  });
  assert.ok(
    Array.isArray(semanticTokens?.data) && semanticTokens.data.length > 0,
    "Expected semantic tokens",
  );

  const rename = await harness.request("textDocument/rename", {
    textDocument: { uri: mainUri },
    position: doublePosition,
    newName: "twice",
  });
  const renamedUris = Object.keys(rename?.changes ?? {});
  assert.ok(
    renamedUris.includes(mainUri) && renamedUris.includes(mathUri),
    "Expected cross-file rename",
  );

  const evaluation = await harness.request("metta/evaluateGuarded", {
    uri: mainUri,
    includePriorDefinitions: true,
    wrapBareExpression: false,
  });
  assert.equal(evaluation.ok, true, JSON.stringify(evaluation));
  assert.ok(
    evaluation.queries.some((query) => query.results.includes("42")),
    `Expected guarded evaluation to produce 42, got ${JSON.stringify(evaluation.queries)}`,
  );

  const cancelledUri = `${rootUri}/cancelled.metta`;
  const cancelledSource = `(= (forever $x) (forever $x))
!(forever 0)`;
  workspace.set(cancelledUri, cancelledSource);
  await harness.open(cancelledUri, cancelledSource);
  const startedAt = performance.now();
  const cancelled = harness.requestWithId("metta/evaluateGuarded", {
    uri: cancelledUri,
    includePriorDefinitions: true,
    wrapBareExpression: false,
    policy: { fuel: 1_000_000, timeoutMs: 10_000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  harness.cancelRequest(cancelled.id);
  await assert.rejects(cancelled.promise, /Evaluation cancelled/u);
  assert.ok(
    performance.now() - startedAt < 2_000,
    "Expected cancellation to stop browser evaluation before its timeout",
  );
} finally {
  harness.dispose();
}

const preopenedWorkspace = new Map([
  [mainUri, mainSource],
  [mathUri, mathSource],
]);
const preopenedHarness = createBrowserLspHarness(preopenedWorkspace, {
  rootUri,
  script: new URL("../docs-site/public/browser-ide/server/browserServer.js", import.meta.url),
  timeoutMs: 20_000,
});
try {
  await preopenedHarness.initialize({
    capabilities: {
      experimental: { mettaBrowserIde: { preopenedWorkspace: true } },
    },
  });
  const diagnosticsReady = preopenedHarness.waitDiagnostics(mainUri, (items) =>
    items.some((diagnostic) => diagnostic.code === "call.arity"),
  );
  preopenedHarness.notify("textDocument/didOpen", {
    textDocument: { uri: mainUri, languageId: "metta", version: 0, text: mainSource },
  });
  preopenedHarness.notify("textDocument/didOpen", {
    textDocument: { uri: mathUri, languageId: "metta", version: 0, text: mathSource },
  });
  const workspaceReady = await Promise.all([
    preopenedHarness.request("metta/browserWorkspaceReady", {}),
    preopenedHarness.request("metta/browserWorkspaceReady", {}),
  ]);
  assert.deepEqual(workspaceReady, [
    { accepted: true, files: 2 },
    { accepted: true, files: 2 },
  ]);
  assert.equal(preopenedHarness.serverRequestCount("metta/fs/listFiles"), 0);
  assert.ok(
    (await diagnosticsReady).some((diagnostic) => diagnostic.code === "call.arity"),
    "Expected preopened browser workspace diagnostics after the readiness handshake",
  );
} finally {
  preopenedHarness.dispose();
}

process.stdout.write("browser IDE worker smoke passed\n");
