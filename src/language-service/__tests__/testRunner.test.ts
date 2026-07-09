// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The pure test model: discovering assert forms from source and classifying evaluation results, using the
// pass/fail shapes core's interpreter actually produces (unit on success, an (Error ...) atom on failure).

import { describe, expect, it } from "vitest";
import {
  classifyTestQueries,
  discoverTests,
  headOf,
  summarize,
  type TestResult,
  toJUnitXml,
} from "../testRunner.js";

describe("discoverTests", () => {
  it("finds bang-prefixed assert forms with their spans", () => {
    const src = "(= (f $x) (* $x 2))\n!(assertEqual (f 3) 6)\n!(assertAlphaEqual (a $x) (a $y))";
    const tests = discoverTests(src);
    expect(tests.map((t) => t.name)).toEqual([
      "(assertEqual (f 3) 6)",
      "(assertAlphaEqual (a $x) (a $y))",
    ]);
  });

  it("ignores a bare assert form (no bang) and non-assert bang forms", () => {
    const src = "(assertEqual 1 1)\n!(println! hi)\n!(+ 1 2)";
    expect(discoverTests(src)).toEqual([]);
  });
});

describe("headOf", () => {
  it("reads the head symbol of a rendered form", () => {
    expect(headOf("(assertEqual (+ 1 1) 2)")).toBe("assertEqual");
    expect(headOf("()")).toBe("");
    expect(headOf("atom")).toBe("");
  });
});

describe("classifyTestQueries", () => {
  it("passes an assert that reduced to unit", () => {
    const results = classifyTestQueries([{ query: "(assertEqual (+ 1 1) 2)", results: ["()"] }]);
    expect(results).toEqual([{ name: "(assertEqual (+ 1 1) 2)", status: "pass" }]);
  });

  it("fails an assert that reduced to an Error atom, keeping the message", () => {
    const err = "(Error (assertEqual (+ 1 1) 3) results-are-not-equal)";
    const results = classifyTestQueries([{ query: "(assertEqual (+ 1 1) 3)", results: [err] }]);
    expect(results[0]?.status).toBe("fail");
    expect(results[0]?.message).toBe(err);
  });

  it("flags an unreduced assert as an error, not a silent pass", () => {
    const results = classifyTestQueries([
      { query: "(assertEqual (loop) 1)", results: ["(assertEqual (loop) 1)"] },
    ]);
    expect(results[0]?.status).toBe("error");
  });

  it("skips non-assert bang forms", () => {
    const results = classifyTestQueries([
      { query: "(println! hi)", results: ["()"] },
      { query: "(assertEqual 1 1)", results: ["()"] },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe("(assertEqual 1 1)");
  });
});

describe("summarize", () => {
  it("counts by status", () => {
    const results: TestResult[] = [
      { name: "a", status: "pass" },
      { name: "b", status: "fail" },
      { name: "c", status: "pass" },
      { name: "d", status: "error" },
    ];
    expect(summarize(results)).toEqual({ total: 4, passed: 2, failed: 1, errored: 1 });
  });
});

describe("toJUnitXml", () => {
  it("emits a valid JUnit report with failures escaped", () => {
    const results: TestResult[] = [
      { name: "(assertEqual (+ 1 1) 2)", status: "pass" },
      { name: "(assertEqual (f <x>) 3)", status: "fail", message: '(Error "bad" & <thing>)' },
      { name: "(assertEqual (g) 4)", status: "error", message: "no result" },
    ];
    const xml = toJUnitXml(results);
    expect(xml).toContain('<testsuites tests="3" failures="1" errors="1">');
    expect(xml).toContain('<testcase name="(assertEqual (+ 1 1) 2)" />');
    // failure carries the message with XML metacharacters escaped
    expect(xml).toContain("<failure");
    expect(xml).toContain("&amp; &lt;thing&gt;");
    expect(xml).toContain("&lt;x&gt;");
    expect(xml).toContain("<error");
    // no raw metacharacters leaked into the document body
    expect(xml).not.toContain("<thing>");
  });
});
