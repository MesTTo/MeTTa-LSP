// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Correctness proof for the red-green incremental DB: memoization, revision-gated recompute, the no-op
// write firewall, and the early-cutoff behaviour that makes a formatting-only edit not re-run diagnostics,
// each observed through run counters, plus a property that the memoized result always equals a from-scratch
// computation across arbitrary edit sequences.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { IncrementalDb, type Query } from "../incrementalDb.js";

describe("IncrementalDb red-green memoization", () => {
  it("memoizes: a query is not re-run while its inputs are unchanged", () => {
    const db = new IncrementalDb();
    db.setInput("x", 2);
    let runs = 0;
    const double: Query<null, number> = {
      id: "double",
      key: () => "",
      run: (ctx) => {
        runs++;
        return (ctx.input("x") as number) * 2;
      },
    };
    expect(db.query(double, null)).toBe(4);
    expect(db.query(double, null)).toBe(4);
    expect(runs).toBe(1);
  });

  it("recomputes when a dependency input changes", () => {
    const db = new IncrementalDb();
    db.setInput("x", 2);
    let runs = 0;
    const double: Query<null, number> = {
      id: "double",
      key: () => "",
      run: (ctx) => {
        runs++;
        return (ctx.input("x") as number) * 2;
      },
    };
    expect(db.query(double, null)).toBe(4);
    db.setInput("x", 5);
    expect(db.query(double, null)).toBe(10);
    expect(runs).toBe(2);
  });

  it("a no-op input write neither bumps the revision nor recomputes", () => {
    const db = new IncrementalDb();
    db.setInput("x", 2);
    let runs = 0;
    const double: Query<null, number> = {
      id: "double",
      key: () => "",
      run: (ctx) => {
        runs++;
        return (ctx.input("x") as number) * 2;
      },
    };
    db.query(double, null);
    const revision = db.getRevision();
    db.setInput("x", 2);
    expect(db.getRevision()).toBe(revision);
    db.query(double, null);
    expect(runs).toBe(1);
  });

  it("early cutoff: a dependent does not re-run when its dependency recomputes to an equal value", () => {
    const db = new IncrementalDb();
    db.setInput("text", "a b c");
    let wordCountRuns = 0;
    let diagnosticsRuns = 0;
    // Stand-in for parse -> index: the word count is invariant under whitespace-only edits.
    const wordCount: Query<null, number> = {
      id: "wordCount",
      key: () => "",
      run: (ctx) => {
        wordCountRuns++;
        return (ctx.input("text") as string).trim().split(/\s+/).length;
      },
    };
    const diagnostics: Query<null, string> = {
      id: "diagnostics",
      key: () => "",
      run: (ctx) => {
        diagnosticsRuns++;
        return `count=${ctx.query(wordCount, null)}`;
      },
    };
    expect(db.query(diagnostics, null)).toBe("count=3");
    expect(wordCountRuns).toBe(1);
    expect(diagnosticsRuns).toBe(1);

    // A formatting-only edit: the text changes, so wordCount re-runs, but its value is still 3, so the
    // early cutoff means diagnostics is NOT re-run.
    db.setInput("text", "a   b  c");
    expect(db.query(diagnostics, null)).toBe("count=3");
    expect(wordCountRuns).toBe(2);
    expect(diagnosticsRuns).toBe(1);

    // A semantic edit that changes the count re-runs both.
    db.setInput("text", "a b c d");
    expect(db.query(diagnostics, null)).toBe("count=4");
    expect(wordCountRuns).toBe(3);
    expect(diagnosticsRuns).toBe(2);
  });

  it("propagates and early-cuts through a transitive chain c -> b -> a", () => {
    const db = new IncrementalDb();
    db.setInput("a", 4);
    let bRuns = 0;
    let cRuns = 0;
    // b = whether a is even (changes rarely); c depends on b.
    const b: Query<null, boolean> = {
      id: "b",
      key: () => "",
      run: (ctx) => {
        bRuns++;
        return (ctx.input("a") as number) % 2 === 0;
      },
    };
    const c: Query<null, string> = {
      id: "c",
      key: () => "",
      run: (ctx) => {
        cRuns++;
        return ctx.query(b, null) ? "even" : "odd";
      },
    };
    expect(db.query(c, null)).toBe("even");
    expect(bRuns).toBe(1);
    expect(cRuns).toBe(1);

    // 4 -> 6: b re-runs, stays true, so c does not re-run (transitive early cutoff).
    db.setInput("a", 6);
    expect(db.query(c, null)).toBe("even");
    expect(bRuns).toBe(2);
    expect(cRuns).toBe(1);

    // 6 -> 7: b flips to false, c re-runs.
    db.setInput("a", 7);
    expect(db.query(c, null)).toBe("odd");
    expect(bRuns).toBe(3);
    expect(cRuns).toBe(2);
  });

  it("throws a clear error on a dependency cycle instead of overflowing the stack", () => {
    const db = new IncrementalDb();
    db.setInput("x", 0);
    // Two queries that read each other: a real cycle. The engine's queries are a DAG by design, so this can
    // only arise from a wiring mistake; it must surface loudly, not hang.
    const ping: Query<null, number> = {
      id: "ping",
      key: () => "",
      run: (ctx) => ctx.query(pong, null) + 1,
    };
    const pong: Query<null, number> = {
      id: "pong",
      key: () => "",
      run: (ctx) => ctx.query(ping, null) + 1,
    };
    expect(() => db.query(ping, null)).toThrow(/dependency cycle detected/);
  });

  it("memoized results always equal a from-scratch computation across arbitrary edits", () => {
    const formula = (x: number, y: number): number => x * 3 + y * y - 1;
    expect(() =>
      fc.assert(
        fc.property(
          fc.array(fc.tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 })), {
            minLength: 1,
            maxLength: 40,
          }),
          (edits) => {
            const db = new IncrementalDb();
            const inner: Query<null, number> = {
              id: "inner",
              key: () => "",
              run: (ctx) => (ctx.input("y") as number) * (ctx.input("y") as number),
            };
            const outer: Query<null, number> = {
              id: "outer",
              key: () => "",
              run: (ctx) => (ctx.input("x") as number) * 3 + ctx.query(inner, null) - 1,
            };
            for (const [x, y] of edits) {
              db.setInput("x", x);
              db.setInput("y", y);
              if (db.query(outer, null) !== formula(x, y)) return false;
            }
            return true;
          },
        ),
        { numRuns: 300 },
      ),
    ).not.toThrow();
  });
});
