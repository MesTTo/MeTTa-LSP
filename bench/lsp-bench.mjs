#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Benchmark the language server's hot operations on generated files of increasing size. Full-file validate
// still exercises core's check-types path, so this tracks both cold context construction and the warm cache.
// Hover, completion, go-to-definition, semantic tokens, document symbols, runtime workers, and semantic lint
// are timed separately.
//
// Usage:
//   npm run bench:lsp                 run and, if bench/RESULTS-lsp.md exists, compare against it
//   npm run bench:lsp -- --update     rewrite bench/RESULTS-lsp.md with this run as the new baseline
//   npm run bench:lsp -- --only=large restrict to one size (small | medium | large)
//   npm run bench:lsp:profile         same, under --cpu-prof; open the .cpuprofile in DevTools/VS Code
//
// The absolute milliseconds are machine-specific, so the committed baseline is a reference for regressions on
// the same machine, not an absolute target. A median more than 25% over baseline is flagged and fails the run.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);
const { Analyzer } = require("../dist/server/analyzer.js");
const { InMemoryFileProvider } = require("../dist/server/fileProvider.js");
const { runSemanticLint } = require("../dist/language-service/index.js");
const { evaluateGuarded } = require("../dist/runtime/guardedEvaluation.js");

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "RESULTS-lsp.md");
const UPDATE = process.argv.includes("--update");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice("--only=".length);
const REGRESSION_RATIO = 1.25;
const WORKER_REGRESSION_RATIO = 1.75;
// A regression must also be absolutely significant: sub-millisecond operations (hover, definition) are noisy,
// so a large ratio on a 0.2ms baseline is not a real regression.
const REGRESSION_MIN_MS = 1;
const WORKER_REGRESSION_MIN_MS = 10;
const URI = "file:///bench/f.metta";

// A benchmark is a CLI reporter, so it writes straight to the streams rather than through the console.
const print = (line = "") => process.stdout.write(`${line}\n`);
const printErr = (line) => process.stderr.write(`${line}\n`);

// A file of `count` typed functions, each a declaration, a rule, and a bang call, so validate exercises
// check-types on every call. Every tenth call is deliberately ill-typed to exercise the diagnostic path.
function generateFile(count) {
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(`(: fn${i} (-> Number Number))`);
    lines.push(`(= (fn${i} $x) (+ $x ${i}))`);
    lines.push(i % 10 === 0 ? `!(fn${i} "bad")` : `!(fn${i} ${i})`);
  }
  return lines.join("\n");
}

function analyzerFor(text) {
  const files = new InMemoryFileProvider("/bench");
  files.writeFile("/bench/f.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///bench"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function summarize(times) {
  times.sort((a, b) => a - b);
  return { min: times[0], median: times[Math.floor(times.length / 2)] };
}

// Warm the JIT, then time `runs` calls and take the min and median.
function measure(fn, runs = 9) {
  fn();
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return summarize(times);
}

async function measureAsync(fn, runs = 7) {
  await fn();
  await fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return summarize(times);
}

// Cold validate: a fresh analyzer each run so the check-types cache and declaration context start empty.
function measureColdValidate(text, runs = 5) {
  analyzerFor(text).validate(URI);
  const times = [];
  for (let i = 0; i < runs; i++) {
    const analyzer = analyzerFor(text);
    const start = performance.now();
    analyzer.validate(URI);
    times.push(performance.now() - start);
  }
  return summarize(times);
}

const ALL_SIZES = [
  { name: "small", count: 10 },
  { name: "medium", count: 100 },
  { name: "large", count: 1000 },
];
const SIZES = ALL_SIZES.filter((size) => ONLY === "" || size.name === ONLY);

// fn0 sits on line 0 (declaration), line 1 (rule), line 2 (call).
const AT_DECL = { line: 0, character: 5 };
const AT_CALL = { line: 2, character: 3 };

// A mini repo: `fileCount` modules of `defsPerFile` typed functions each, every module importing the previous
// and making a cross-file call into it. This drives the workspace paths a single file never touches — the
// directory scan, cross-file import resolution, and workspace symbols.
async function benchRepo(fileCount, defsPerFile) {
  const files = new InMemoryFileProvider("/repo");
  for (let f = 0; f < fileCount; f++) {
    const lines = f > 0 ? [`(import! &self "mod${f - 1}")`] : [];
    for (let i = 0; i < defsPerFile; i++) {
      lines.push(`(: m${f}_${i} (-> Number Number))`);
      lines.push(`(= (m${f}_${i} $x) (+ $x ${i}))`);
    }
    if (f > 0) lines.push(`!(m${f - 1}_0 1)`);
    files.writeFile(`/repo/mod${f}.metta`, lines.join("\n"));
  }
  // Measure the scan over fresh analyzers with min/median, like the other rows. Discard one warmup scan so
  // JIT and parser setup do not decide the baseline, then sample enough runs that a single unlucky pause does
  // not read as a workspace regression.
  const scanTimes = [];
  let analyzer;
  const scanFresh = async () => {
    const next = new Analyzer(files);
    next.setWorkspaceRoots(["file:///repo"]);
    const start = performance.now();
    await next.scanWorkspace();
    return { analyzer: next, elapsed: performance.now() - start };
  };
  await scanFresh();
  for (let i = 0; i < 9; i++) {
    const sample = await scanFresh();
    analyzer = sample.analyzer;
    scanTimes.push(sample.elapsed);
  }
  if (analyzer === undefined) {
    analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///repo"]);
    await analyzer.scanWorkspace();
  }
  const scan = summarize(scanTimes);
  const lastUri = `file:///repo/mod${fileCount - 1}.metta`;
  const symbols = measure(() => analyzer.workspaceSymbols("m0_0"));
  const validate = measure(() => analyzer.validate(lastUri));
  const label = `repo ${fileCount}x${defsPerFile}`;
  const count = fileCount * defsPerFile;
  return [
    { size: label, count, operation: "workspace scan", ...scan },
    { size: label, count, operation: "workspace symbols", ...symbols },
    { size: label, count, operation: "validate (cross-file)", ...validate },
  ];
}

const REPOS =
  ONLY === "" || ONLY === "repo"
    ? [
        { files: 10, defs: 20 },
        { files: 50, defs: 20 },
      ]
    : [];

const GUARDED_POLICY = {
  timeoutMs: 5_000,
  fuel: 50_000,
  maxSourceBytes: 256 * 1024,
  maxResults: 64,
  maxResultChars: 16 * 1024,
  maxOutputChars: 4 * 1024,
};

const GUARDED_ASYNC_SOURCE = `
  !(import! &self concurrency)
  !(par (+ 1 1) (+ 2 2) (+ 3 3) (+ 4 4))
`;

const GUARDED_HYPERPOSE_SOURCE = `
  (: one (-> Number))
  (= (one) 1)
  (: two (-> Number))
  (= (two) 1)
  (: three (-> Number))
  (= (three) 1)
  (: four (-> Number))
  (= (four) 1)
  !(once (hyperpose ((one) (two) (three) (four))))
`;
const BROWSER_ROOT = "vscode-vfs://bench/ws";
const BROWSER_MAIN = `${BROWSER_ROOT}/main.metta`;
const BROWSER_LIB = `${BROWSER_ROOT}/lib.metta`;

function browserWorker(script) {
  return new Worker(new URL("./browser-worker-node-adapter.mjs", import.meta.url), {
    workerData: { script: new URL(script, import.meta.url).href },
    execArgv: [],
  });
}

function createBrowserLspHarness(workspaceFiles = new Map()) {
  const worker = browserWorker("../dist/server/browserServer.js");
  let nextId = 1;
  const pending = new Map();
  const diagnosticsWaiters = [];
  const send = (message) => worker.postMessage({ jsonrpc: "2.0", ...message });
  const respond = (id, result) => send({ id, result });
  const notify = (method, params) => send({ method, params });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      send({ id, method, params });
    });
  const waitDiagnostics = (uri) =>
    new Promise((resolve, reject) => {
      const waiter = {
        uri,
        resolve: (diagnostics) => {
          clearTimeout(timeout);
          resolve(diagnostics);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      };
      const timeout = setTimeout(() => {
        const index = diagnosticsWaiters.indexOf(waiter);
        if (index >= 0) diagnosticsWaiters.splice(index, 1);
        reject(new Error(`diagnostics for ${uri} timed out`));
      }, 10_000);
      diagnosticsWaiters.push(waiter);
    });
  worker.on("message", (message) => {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(String(message.error.message ?? message.error)));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "metta/fs/watchPattern") {
      respond(message.id, { watching: true });
      return;
    }
    if (message.method === "metta/fs/listFiles") {
      const maxFiles = Math.max(0, Number(message.params?.maxFiles ?? workspaceFiles.size));
      const files = [...workspaceFiles.entries()]
        .slice(0, maxFiles)
        .map(([uri, text]) => ({ uri, text }));
      respond(message.id, { files, truncated: workspaceFiles.size > maxFiles });
      return;
    }
    if (message.method === "metta/fs/readFile") {
      const uri = String(message.params?.uri ?? "");
      respond(message.id, { uri, text: workspaceFiles.get(uri) ?? null });
      return;
    }
    if (message.id !== undefined) {
      respond(message.id, null);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      const uri = message.params?.uri;
      const index = diagnosticsWaiters.findIndex((waiter) => waiter.uri === uri);
      if (index >= 0) {
        const [waiter] = diagnosticsWaiters.splice(index, 1);
        waiter.resolve(message.params?.diagnostics ?? []);
      }
    }
  });
  worker.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const waiter of diagnosticsWaiters.splice(0)) waiter.reject(error);
  });
  return {
    async initialize() {
      await request("initialize", {
        processId: null,
        rootUri: BROWSER_ROOT,
        workspaceFolders: [{ uri: BROWSER_ROOT, name: "bench" }],
        capabilities: {},
        clientInfo: { name: "bench" },
      });
      notify("initialized", {});
    },
    async open(uri, text, version = 1) {
      const diagnostics = waitDiagnostics(uri);
      notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "metta", version, text },
      });
      await diagnostics;
    },
    async change(uri, text, version) {
      const diagnostics = waitDiagnostics(uri);
      notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      await diagnostics;
    },
    dispose() {
      worker.terminate().catch(() => undefined);
    },
  };
}

function assertGuardedResult(name, result, expected) {
  const actual = result.queries.at(-1)?.results ?? [];
  if (!result.ok || JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function runGuardedSource(name, source, expected) {
  const result = await evaluateGuarded({
    source,
    wrapBareExpression: false,
    policy: GUARDED_POLICY,
  });
  assertGuardedResult(name, result, expected);
}

function runSemanticLintWorker(source) {
  return runWorkerMessage(
    new Worker(new URL("../dist/runtime/semanticLintWorker.js", import.meta.url), {
      execArgv: [],
    }),
    { source, severities: {} },
    "semantic lint worker",
  );
}

function runWorkerMessage(worker, payload, exitLabel) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, response) => {
      if (settled) return;
      settled = true;
      worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(response);
    };
    worker.once("message", (response) => done(null, response));
    worker.once("error", (error) => done(error));
    worker.once("exit", (code) => {
      if (code !== 0) done(new Error(`${exitLabel} exited with code ${code}`));
    });
    worker.postMessage(payload);
  });
}

async function benchSemanticLintWorker(source) {
  const response = await runSemanticLintWorker(source);
  if (!response?.ok)
    throw new Error(`semantic lint worker failed: ${response?.error ?? "unknown error"}`);
}

function runBrowserEvaluationBundle(source) {
  return runWorkerMessage(
    browserWorker("../dist/runtime/browserEvaluationWorker.js"),
    { source, policy: GUARDED_POLICY, imports: {} },
    "browser evaluation worker",
  );
}

async function benchBrowserEvaluationBundle(name, source, expected) {
  const response = await runBrowserEvaluationBundle(source);
  if (!response?.ok)
    throw new Error(`browser evaluation worker failed: ${response?.error ?? "unknown error"}`);
  const actual = response.queries?.at(-1)?.results ?? [];
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function benchBrowserServerInitialize() {
  const harness = createBrowserLspHarness(new Map([[BROWSER_LIB, "(= (inc $x) (+ $x 1))"]]));
  try {
    await harness.initialize();
  } finally {
    harness.dispose();
  }
}

async function measureBrowserServerValidate(text, runs = 5) {
  const workspace = new Map([
    [BROWSER_LIB, "(: inc (-> Number Number))\n(= (inc $x) (+ $x 1))"],
    [BROWSER_MAIN, text],
  ]);
  const harness = createBrowserLspHarness(workspace);
  try {
    await harness.initialize();
    await harness.open(BROWSER_MAIN, text, 1);
    await harness.change(BROWSER_MAIN, text, 2);
    const times = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await harness.change(BROWSER_MAIN, text, i + 3);
      times.push(performance.now() - start);
    }
    return summarize(times);
  } finally {
    harness.dispose();
  }
}

const RUNTIME_BENCHES =
  ONLY === "" || ONLY === "runtime"
    ? [
        {
          size: "runtime",
          count: 4,
          operation: "guarded eval (async par)",
          run: () =>
            measureAsync(() =>
              runGuardedSource("guarded eval (async par)", GUARDED_ASYNC_SOURCE, [
                "2",
                "4",
                "6",
                "8",
              ]),
            ),
        },
        {
          size: "runtime",
          count: 4,
          operation: "guarded eval (hyperpose workers)",
          run: () =>
            measureAsync(
              () =>
                runGuardedSource("guarded eval (hyperpose workers)", GUARDED_HYPERPOSE_SOURCE, [
                  "1",
                ]),
              5,
            ),
        },
        {
          size: "runtime",
          count: 100,
          operation: "semantic lint (direct)",
          run: () => measure(() => runSemanticLint(generateFile(100), {})),
        },
        {
          size: "runtime",
          count: 100,
          operation: "semantic lint worker",
          run: () => measureAsync(() => benchSemanticLintWorker(generateFile(100)), 5),
        },
        {
          size: "browser-runtime",
          count: 4,
          operation: "browser guarded eval (hyperpose workers)",
          run: () =>
            measureAsync(
              () =>
                benchBrowserEvaluationBundle(
                  "browser guarded eval (hyperpose workers)",
                  GUARDED_HYPERPOSE_SOURCE,
                  ["1"],
                ),
              5,
            ),
        },
      ]
    : [];

const BROWSER_LSP_BENCHES =
  ONLY === "" || ONLY === "browser"
    ? [
        {
          size: "browser-lsp",
          count: 1,
          operation: "server initialize",
          run: () => measureAsync(() => benchBrowserServerInitialize(), 5),
        },
        ...ALL_SIZES.map((size) => ({
          size: `browser-${size.name}`,
          count: size.count,
          operation: "validate",
          run: () => measureBrowserServerValidate(generateFile(size.count)),
        })),
      ]
    : [];

const rows = [];
for (const size of SIZES) {
  const text = generateFile(size.count);
  const warm = analyzerFor(text);
  warm.validate(URI);
  const operations = {
    "validate (cold)": () => measureColdValidate(text),
    "validate (warm)": () => measure(() => warm.validate(URI)),
    hover: () => measure(() => warm.hover(URI, AT_DECL)),
    completions: () => measure(() => warm.completions(URI, AT_DECL)),
    definition: () => measure(() => warm.definition(URI, AT_CALL)),
    "semantic tokens": () => measure(() => warm.semanticTokens(URI)),
    "document symbols": () => measure(() => warm.documentSymbols(URI)),
  };
  for (const [operation, run] of Object.entries(operations)) {
    const { min, median } = run();
    rows.push({ size: size.name, count: size.count, operation, min, median });
  }
}

for (const repo of REPOS) {
  for (const row of await benchRepo(repo.files, repo.defs)) rows.push(row);
}

for (const runtimeBench of RUNTIME_BENCHES) {
  const { min, median } = await runtimeBench.run();
  rows.push({
    size: runtimeBench.size,
    count: runtimeBench.count,
    operation: runtimeBench.operation,
    min,
    median,
  });
}

for (const browserBench of BROWSER_LSP_BENCHES) {
  const { min, median } = await browserBench.run();
  rows.push({
    size: browserBench.size,
    count: browserBench.count,
    operation: browserBench.operation,
    min,
    median,
  });
}

const ms = (value) => value.toFixed(2);
const key = (row) => `${row.size}/${row.operation}`;

function regressionPolicy(row) {
  if (
    (row.size === "runtime" || row.size === "browser-runtime" || row.size === "browser-lsp") &&
    row.operation !== "semantic lint (direct)"
  )
    return { ratio: WORKER_REGRESSION_RATIO, minMs: WORKER_REGRESSION_MIN_MS };
  if (row.operation === "workspace scan") return { ratio: REGRESSION_RATIO, minMs: 5 };
  return { ratio: REGRESSION_RATIO, minMs: REGRESSION_MIN_MS };
}

function renderTable(data) {
  const header = "| size | functions | operation | min ms | median ms |\n|---|---:|---|---:|---:|";
  const body = data
    .map((r) => `| ${r.size} | ${r.count} | ${r.operation} | ${ms(r.min)} | ${ms(r.median)} |`)
    .join("\n");
  return `${header}\n${body}`;
}

function renderReport(data) {
  return `# LSP benchmark

Generated by \`npm run bench:lsp\`. Absolute times are machine-specific; use this as a same-machine regression
reference. Full-file validate includes core \`check-types\`; the cold row includes building the check-types
cache and declaration context, the warm row reuses them. Runtime rows include the worker boundary they
exercise and use a wider regression threshold because worker startup is noisier.

${renderTable(data)}
`;
}

// Parse the median column back out of a committed RESULTS-lsp.md table for comparison.
function parseBaseline(markdown) {
  const medians = new Map();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 7 || cells[1] === "size" || cells[1] === "") continue;
    const median = Number(cells[5]);
    if (Number.isFinite(median)) medians.set(`${cells[1]}/${cells[3]}`, median);
  }
  return medians;
}

print(renderReport(rows));

if (UPDATE) {
  writeFileSync(OUT, renderReport(rows));
  print(`\nWrote baseline to ${OUT}`);
  process.exit(0);
}

if (!existsSync(OUT)) {
  print(`\nNo baseline at ${OUT}; run \`npm run bench:lsp -- --update\` to create one.`);
  process.exit(0);
}

const baseline = parseBaseline(readFileSync(OUT, "utf8"));
const regressions = [];
for (const row of rows) {
  const before = baseline.get(key(row));
  if (before === undefined) continue;
  const ratio = row.median / before;
  const policy = regressionPolicy(row);
  const regressed = ratio > policy.ratio && row.median - before > policy.minMs;
  const marker = regressed ? " <== REGRESSION" : "";
  if (regressed) regressions.push(key(row));
  print(
    `${key(row).padEnd(32)} ${ms(before)} -> ${ms(row.median)} (${ratio.toFixed(2)}x)${marker}`,
  );
}

if (regressions.length > 0) {
  printErr(`\n${regressions.length} operation(s) slower than their configured benchmark baseline.`);
  process.exit(1);
}
print(`\nNo regression over configured benchmark baselines.`);
