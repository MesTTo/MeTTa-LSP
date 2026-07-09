// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The unguarded worker's host-interop recipe, exercised for real minus backend subprocesses. The exact
// composition it runs (bridge prelude + async ops + core's async runner) evaluates Python against
// @metta-ts/py's MockPyBridge and Prolog against @metta-ts/prolog's MockPrologBridge. The live backend paths
// are covered by smoke tests when python3/pythonia and swipl are present. Source gates are pinned here too.

import { type AsyncGroundFn, format, runProgramAsync } from "@metta-ts/core";
import { MockPrologBridge, PROLOG_METTA_SRC, prologCoreAsyncOps } from "@metta-ts/prolog";
import { MockPyBridge, PY_METTA_SRC, pyCoreAsyncOps } from "@metta-ts/py";
import { describe, expect, it } from "vitest";
import { sourceUsesProlog, sourceUsesPython } from "../guardedEvaluation.js";

function runInteropSource(source: string, asyncOps: Map<string, AsyncGroundFn>) {
  return runProgramAsync(source, asyncOps, 20_000, new Map(), { maxStackDepth: 512 });
}

async function formattedInteropResults(
  source: string,
  asyncOps: Map<string, AsyncGroundFn>,
): Promise<string[]> {
  const results = await runInteropSource(source, asyncOps);
  return results.flatMap((query) => query.results.map((atom) => format(atom)));
}

describe("the unguarded worker's Python composition", () => {
  it("evaluates py-eval through the prelude and the bridge ops", async () => {
    const source = `${PY_METTA_SRC}\n!(py-eval "2 ** 10")`;
    await expect(
      formattedInteropResults(source, pyCoreAsyncOps(new MockPyBridge())),
    ).resolves.toStrictEqual(["1024"]);
  });

  it("the prelude contributes no query results of its own", async () => {
    const results = await runInteropSource(PY_METTA_SRC, pyCoreAsyncOps(new MockPyBridge()));
    expect(results).toStrictEqual([]);
  });
});

describe("the unguarded worker's Prolog composition", () => {
  it("evaluates prolog-match through the prelude and the bridge ops", async () => {
    const source = `${PROLOG_METTA_SRC}
!(prolog-assertz (edge alice bob))
!(prolog-match (edge alice $x) $x)`;
    await expect(
      formattedInteropResults(source, prologCoreAsyncOps(new MockPrologBridge())),
    ).resolves.toStrictEqual(["True", "bob"]);
  });

  it("the prelude contributes no query results of its own", async () => {
    const results = await runInteropSource(
      PROLOG_METTA_SRC,
      prologCoreAsyncOps(new MockPrologBridge()),
    );
    expect(results).toStrictEqual([]);
  });
});

describe("sourceUsesPython — the bridge gate", () => {
  it("sees py- heads used as symbols", () => {
    expect(sourceUsesPython('!(py-eval "1")')).toBe(true);
    expect(sourceUsesPython("!((py-atom operator.add) 40 2)")).toBe(true);
    expect(sourceUsesPython("(= (f $x) (py-call (str $x)))")).toBe(true);
  });

  it("ignores plain MeTTa, lookalike names, comments, and strings", () => {
    expect(sourceUsesPython("(= (f $x) $x)\n!(f 1)")).toBe(false);
    expect(sourceUsesPython("!(mypy-atom 1)")).toBe(false);
    expect(sourceUsesPython("; py-eval is only mentioned here")).toBe(false);
    expect(sourceUsesPython('!(println! "py-eval")')).toBe(false);
  });
});

describe("sourceUsesProlog — the bridge gate", () => {
  it("sees Prolog bridge heads used as symbols", () => {
    expect(sourceUsesProlog("!(prolog-call (edge alice $x))")).toBe(true);
    expect(sourceUsesProlog("!(assertzPredicate (Predicate (edge alice bob)))")).toBe(true);
    expect(sourceUsesProlog('!(import_prolog_functions_from_file "facts.pl" (edge))')).toBe(true);
  });

  it("ignores plain MeTTa, lookalike names, comments, and strings", () => {
    expect(sourceUsesProlog("(= (f $x) $x)\n!(f 1)")).toBe(false);
    expect(sourceUsesProlog("!(my-prolog-call 1)")).toBe(false);
    expect(sourceUsesProlog("; prolog-call is only mentioned here")).toBe(false);
    expect(sourceUsesProlog('!(println! "prolog-call")')).toBe(false);
  });
});
