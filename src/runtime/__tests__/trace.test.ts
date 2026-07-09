// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The reduction trace: a pure renderer over reduction states, and the end-to-end trace over the real hyperon
// runner and grapher's `reduceTrace`.

import { describe, expect, it } from "vitest";
import { renderTrace, traceReduction } from "../trace.js";

describe("renderTrace", () => {
  it("renders each reduction state and reports the final one", () => {
    const states = [["(double 21)"], ["(* 2 21)"], ["42"]];
    const result = renderTrace("(double 21)", states, (atom) => atom, 100);
    expect(result.steps).toEqual([["(double 21)"], ["(* 2 21)"], ["42"]]);
    expect(result.final).toEqual(["42"]);
    expect(result.truncated).toBe(false);
  });

  it("marks the trace truncated when the step budget is reached", () => {
    expect(renderTrace("q", [["a"], ["b"]], (atom) => atom, 2).truncated).toBe(true);
  });
});

describe("traceReduction", () => {
  it("traces a query's reduction end to end", async () => {
    const result = await traceReduction("(= (double $x) (* 2 $x))", "(double 21)", 50);
    expect(result.steps[0]).toEqual(["(double 21)"]);
    expect(result.final).toEqual(["42"]);
  });

  it("reduces a query against the file's imports (cross-file)", async () => {
    // square is defined only in the imported module source; the program's own (import! …) is inert here.
    const result = await traceReduction("(import! &self geometry)", "(square 5)", 50, {
      geometry: "(= (square $x) (* $x $x))",
    });
    expect(result.final).toEqual(["25"]);
  });

  it("rejects a query that does not parse", async () => {
    await expect(traceReduction("", "")).rejects.toThrow("could not parse");
  });
});
