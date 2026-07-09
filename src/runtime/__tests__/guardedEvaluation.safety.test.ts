// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The safety proof for capability-based guarded evaluation. Guarded evaluation is safe not because it scans
// the source for dangerous symbols (it no longer does), but because the worker registers core plus the
// source-only Node runner, with core host effects disabled. An effectful grounded atom (js-atom host JS,
// system! shell, http! network, fs-backed import!) is absent or inert. This test pins that structural
// guarantee and pins the resource ceiling that bounds nonterminating programs, and it pins that the old
// deny-list's false positives (superpose/let/collapse/case) now evaluate.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { format, runProgram, setOutputSink } from "@metta-ts/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_GUARDED_EVALUATION_POLICY } from "../../server/guardedEvaluationTypes.js";
import {
  evaluateGuarded,
  evaluateUnguarded,
  guardSource,
  mergeGuardedEvaluationPolicy,
} from "../guardedEvaluation.js";

// Evaluate through the same core entry the worker uses (runProgram with fuel + a stack bound and no
// injected imports), and collect the formatted results.
function evalResults(source: string, fuel = 20_000): string[] {
  return runProgram(source, fuel, new Map(), { maxStackDepth: 512 }).flatMap((query) =>
    query.results.map((atom) => format(atom)),
  );
}

async function expectGuardedResults(source: string, expected: readonly string[]): Promise<void> {
  const result = await evaluateGuarded({ source, wrapBareExpression: false });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.queries.at(-1)?.results).toStrictEqual(expected);
}

describe("guarded evaluation — the capability boundary is the guard", () => {
  const workerSource = readFileSync(
    fileURLToPath(new URL("../evaluationWorker.ts", import.meta.url)),
    "utf8",
  );
  const browserWorkerSource = readFileSync(
    fileURLToPath(new URL("../browserEvaluationWorker.ts", import.meta.url)),
    "utf8",
  );
  const sharedSource = readFileSync(
    fileURLToPath(new URL("../workerShared.ts", import.meta.url)),
    "utf8",
  );
  const unguardedSource = readFileSync(
    fileURLToPath(new URL("../unguardedWorker.ts", import.meta.url)),
    "utf8",
  );

  it("the guarded worker imports core plus the source-only Node runner and no effectful package", () => {
    // The guarded worker may use @metta-ts/node/source for in-memory async evaluation and hyperpose worker
    // threads. It must not import the root file-backed Node package, the hyperon js-atom bridge, the DAS
    // network client, the Python bridge, or a raw node effect module.
    const forbidden = [
      'import("@metta-ts/node")',
      "@metta-ts/hyperon",
      "@metta-ts/das-client",
      "@metta-ts/das-gateway",
      "@metta-ts/py",
      "@metta-ts/prolog",
      "pythonia",
      "node:fs",
      "node:child_process",
      "node:net",
      "node:http",
      "node:https",
      "node:dgram",
    ];
    for (const source of [workerSource, sharedSource]) {
      expect(forbidden.filter((pkg) => source.includes(pkg))).toStrictEqual([]);
    }
    expect(workerSource).toContain('import("@metta-ts/core")');
    expect(workerSource).toContain('import("@metta-ts/node/source")');
    // The guarded worker must also disable core's host-effect capability, so fileio/git-import! — core
    // grounded ops that reach node:fs/child_process at runtime via process.getBuiltinModule — stay inert here
    // even though they are registered. The unguarded worker keeps the capability (its run is the user's
    // explicit choice). The behavioural proof is scripts/smoke-guarded-safety.mjs.
    expect(workerSource).toContain("setHostEffectsEnabled(false)");
    expect(unguardedSource).not.toContain("setHostEffectsEnabled(false)");
  });

  it("the browser guarded worker imports browser source only and no Node package", () => {
    const forbidden = [
      'import("@metta-ts/node")',
      'import("@metta-ts/node/source")',
      "@metta-ts/hyperon",
      "@metta-ts/das-client",
      "@metta-ts/das-gateway",
      "@metta-ts/py",
      "@metta-ts/prolog",
      "pythonia",
      "node:",
    ];
    for (const source of [browserWorkerSource, sharedSource]) {
      expect(forbidden.filter((pkg) => source.includes(pkg))).toStrictEqual([]);
    }
    expect(browserWorkerSource).toContain('import("@metta-ts/core")');
    expect(browserWorkerSource).toContain('import("@metta-ts/browser/source")');
    expect(browserWorkerSource).toContain("setHostEffectsEnabled(false)");
  });

  it("the unguarded worker adds requested host interops dynamically and disposes them", () => {
    // Python and Prolog are explicit Run capabilities. They load lazily (a run without matching heads never
    // starts a backend), and the composed host interop is disposed on the way out so the long-lived server
    // does not accumulate child processes.
    expect(unguardedSource).toContain('import("pythonia")');
    expect(unguardedSource).toContain('import("@metta-ts/py")');
    expect(unguardedSource).toContain('import("@metta-ts/py/pythonia")');
    expect(unguardedSource).toContain('import("@metta-ts/prolog")');
    expect(unguardedSource).toContain('import("@metta-ts/prolog/swi-node")');
    expect(unguardedSource).toContain("composeHostInterops");
    expect(unguardedSource).toContain("runSourceAsync");
    expect(unguardedSource).toContain("host?.dispose?.()");
    const forbidden = [
      'import("@metta-ts/node")',
      "@metta-ts/hyperon",
      "@metta-ts/das-client",
      "@metta-ts/das-gateway",
      "node:fs",
      "node:child_process",
      "node:net",
      "node:http",
      "node:https",
      "node:dgram",
    ];
    expect(forbidden.filter((pkg) => unguardedSource.includes(pkg))).toStrictEqual([]);
    expect(unguardedSource).toContain('import("@metta-ts/node/source")');
  });
});

describe("guarded evaluation — core alone is inherently side-effect-safe", () => {
  it("evaluates idiomatic MeTTa the old deny-list wrongly blocked", () => {
    expect(evalResults("!(superpose (1 2 3))")).toStrictEqual(["1", "2", "3"]);
    expect(evalResults("!(let $x 1 (+ $x 1))")).toStrictEqual(["2"]);
    expect(evalResults("!(collapse (superpose (1 2)))")).toStrictEqual(["(, 1 2)"]);
    expect(evalResults("!(case 1 ((1 yes) (2 no)))")).toStrictEqual(["yes"]);
  });

  it("leaves effectful grounded atoms unreduced — absent means they cannot act", () => {
    // js-atom would run host JS if the hyperon bridge were registered; it is not, so the call is inert data
    // and this process is still alive to make the assertion.
    expect(evalResults('!(js-atom "process.exit(1)")')).toStrictEqual([
      '(js-atom "process.exit(1)")',
    ]);
    expect(evalResults('!(system! "echo pwned")')).toStrictEqual(['(system! "echo pwned")']);
    expect(evalResults('!(http! "http://evil.example")')).toStrictEqual([
      '(http! "http://evil.example")',
    ]);
  });

  it("cannot read the filesystem: import! resolves only injected sources, never disk", () => {
    // Empty imports map and no fs in core, so import! of an unindexed path yields unit, not file contents.
    expect(evalResults('!(import! &self "/etc/passwd")')).toStrictEqual(["()"]);
  });

  it("bounds a nonterminating program by fuel instead of hanging", () => {
    // (loop) rewrites to itself forever; a small fuel budget cuts it to the unreduced call and returns.
    expect(evalResults("(= (loop) (loop))\n!(loop)", 500)).toStrictEqual(["(loop)"]);
  });

  it("captures print! output instead of letting it escape to the host", () => {
    let captured = "";
    const previous = setOutputSink((line: string) => {
      captured += line;
    });
    try {
      evalResults('!(println! "captured-not-escaped")');
    } finally {
      setOutputSink(previous);
    }
    expect(captured).toContain("captured-not-escaped");
  });

  it("evaluates async concurrency forms through the guarded worker", async () => {
    expect.hasAssertions();
    await expectGuardedResults("!(import! &self concurrency)\n!(par (+ 1 1) (+ 2 2))", ["2", "4"]);
  });

  it("evaluates PeTTa's with_mutex spelling through the guarded worker", async () => {
    expect.hasAssertions();
    await expectGuardedResults("!(import! &self concurrency)\n!(with_mutex L (+ 1 1))", ["2"]);
  });

  it("does not inherit hostile Node execArgv into workers", async () => {
    expect.hasAssertions();
    const previous = [...process.execArgv];
    process.execArgv.push("--input-type=module");
    try {
      await expectGuardedResults("!(+ 1 1)", ["2"]);
    } finally {
      process.execArgv.splice(0, process.execArgv.length, ...previous);
    }
  });
});

describe("guardSource — non-capability blockers only, no symbol scan", () => {
  const clean = "!(+ 1 2)";

  it("raises no blocker for forms the old scanner flagged", () => {
    for (const source of [
      "!(superpose (1 2))",
      "!(let $x 1 $x)",
      "!(collapse (superpose (1 2)))",
      '!(println! "x")',
      '!(import! &self "m.metta")',
      '!(system! "echo x")',
    ]) {
      expect(guardSource(source).blockers).toStrictEqual([]);
    }
  });

  it("blocks when evaluation is disabled", () => {
    const policy = mergeGuardedEvaluationPolicy({ enabled: false });
    expect(guardSource(clean, undefined, policy).blockers).toContain(
      "Guarded evaluation is disabled by policy.",
    );
  });

  it("blocks when the engine is off", () => {
    const policy = mergeGuardedEvaluationPolicy({ engine: "off" });
    expect(guardSource(clean, undefined, policy).blockers).toContain(
      "Evaluation engine is set to off.",
    );
  });

  it("blocks source over the byte cap", () => {
    const policy = mergeGuardedEvaluationPolicy({ maxSourceBytes: 4 });
    expect(
      guardSource("!(+ 1 2 3 4 5)", undefined, policy).blockers.some((b) => b.includes("bytes")),
    ).toBe(true);
  });

  it("blocks on a syntax error", () => {
    expect(
      guardSource("!(+ 1 2", undefined, DEFAULT_GUARDED_EVALUATION_POLICY).blockers.some((b) =>
        b.includes("syntax"),
      ),
    ).toBe(true);
  });
});

describe("unguarded run — no caps beyond the configurable fuel/timeout", () => {
  it("reports guarded=false and lifts the source-size cap, still needing clean syntax", async () => {
    // Over the 2 MB guard byte cap (via a comment that is cheap to parse), plus a trailing syntax error so
    // the pre-flight returns before spawning a worker (which vitest cannot resolve). The guarded path would
    // block on size; the unguarded path must not, and must report guarded=false.
    const oversized = `; ${"x".repeat(2_200_000)}\n(= (f`;
    const result = await evaluateUnguarded({
      source: oversized,
      policy: DEFAULT_GUARDED_EVALUATION_POLICY,
      wrapBareExpression: false,
    });
    expect(result.guarded).toBe(false);
    expect(result.blockers.some((blocker) => blocker.includes("bytes"))).toBe(false);
    expect(result.blockers.some((blocker) => blocker.toLowerCase().includes("syntax"))).toBe(true);
  });
});
