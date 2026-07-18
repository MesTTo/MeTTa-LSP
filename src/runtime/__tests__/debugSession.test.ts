// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The step-through reduction session: it advances a query one rewrite at a time to its normal form, runs to
// completion on continue, and flags a breakpoint atom.

import { describe, expect, it } from "vitest";
import { createReductionSession } from "../debugSession.js";

const QUEUE_SOURCE = `
  (: Score (-> Expression Number))
  (= (Score (item $name $score)) $score)
  (= (Score ()) -99999.0)
  (: LimitSize (-> Expression Number Expression))
  (= (LimitSize $L $size)
     (top-k-by-atom Score $size $L))`;

describe("ReductionSession", () => {
  it("steps a query through its reduction to normal form", async () => {
    const session = await createReductionSession("(= (double $x) (* 2 $x))", "(double 21)");
    expect(session.state().expression).toBe("(double 21)");
    expect(session.step().expression).toBe("(* 2 21)");
    expect(session.step().expression).toBe("42");
    const done = session.step();
    expect(done.done).toBe(true);
    expect(done.step).toBe(2);
  });

  it("continues to the normal form when there is no breakpoint", async () => {
    const session = await createReductionSession("(= (double $x) (* 2 $x))", "(double 21)");
    const final = session.continue();
    expect(final.done).toBe(true);
    expect(final.expression).toBe("42");
  });

  it("flags a breakpoint atom in the current expression", async () => {
    const session = await createReductionSession("", "(breakpoint! 1)");
    expect(session.state().atBreakpoint).toBe(true);
  });

  it("exposes the engine trace summary for debug variables", async () => {
    const session = await createReductionSession(
      QUEUE_SOURCE,
      "(LimitSize ((item a 1) (item b 3) (item c 2)) 2)",
    );

    expect(session.state().trace.grounded["top-k-by-atom"]).toBe(1);
    expect(session.state().trace.reductions).toBeGreaterThan(0);
  });

  it("stops continue at the engine overflow cut point", async () => {
    const session = await createReductionSession("(= (loop $n) (loop (+ $n 1)))", "(loop 0)");

    const stopped = session.continue();

    expect(stopped.atOverflowCutPoint).toBe(true);
    expect(stopped.expression).toBe("(loop 0)");
    expect(stopped.trace.overflow).toEqual(["(loop 0)"]);
  });

  it("rejects an unparseable query", async () => {
    await expect(createReductionSession("", "")).rejects.toThrow("could not parse");
  });
});
