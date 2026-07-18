// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// @metta-ts/debug integration: the LSP inlines already-resolved imports, injects the Node runSource runner,
// and reports the same summary fields as metta-debug why.

import { describe, expect, it } from "vitest";
import { collectMettaEngineTrace, explainMettaCall } from "../debugTrace.js";

const QUEUE_SOURCE = `
  (: Score (-> Expression Number))
  (= (Score (item $name $score)) $score)
  (= (Score ()) -99999.0)
  (: LimitSize (-> Expression Number Expression))
  (= (LimitSize $L $size)
     (top-k-by-atom Score $size $L))`;

describe("metta-ts debugger trace integration", () => {
  it("explains a call against inlined resolved imports", async () => {
    const explanation = await explainMettaCall(
      "!(import! &self geometry)\n(= (main $x) (square $x))",
      "(main 5)",
      { geometry: "(= (square $x) (* $x $x))" },
    );

    expect(explanation.result).toEqual(["25"]);
    expect(explanation.summary.reductions).toBeGreaterThan(0);
  });

  it("summarizes grounded reducers from the engine trace", async () => {
    const explanation = await explainMettaCall(
      QUEUE_SOURCE,
      "(LimitSize ((item a 1) (item b 3) (item c 2)) 2)",
    );

    expect(explanation.result).toEqual(["((item b 3))"]);
    expect(explanation.summary.grounded["top-k-by-atom"]).toBe(1);
  });

  it("collects overflow cut points for the debug adapter", async () => {
    const trace = await collectMettaEngineTrace("(= (loop $n) (loop (+ $n 1)))", "(loop 0)");

    expect(trace.summary.overflow).toEqual(["(loop 0)"]);
    expect(trace.trace.at(-1)).toEqual({ kind: "overflow", atom: "(loop 0)" });
  });
});
