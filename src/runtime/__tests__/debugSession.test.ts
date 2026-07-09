// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The step-through reduction session: it advances a query one rewrite at a time to its normal form, runs to
// completion on continue, and flags a breakpoint atom.

import { describe, expect, it } from "vitest";
import { createReductionSession } from "../debugSession.js";

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

  it("rejects an unparseable query", async () => {
    await expect(createReductionSession("", "")).rejects.toThrow("could not parse");
  });
});
