// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The MeTTa test model. A test is a top-level bang form whose head is a stdlib assert (assertEqual and its
// family). Running one reduces it to unit `()` on success or to an `(Error <form> <reason>)` atom on failure,
// which the interpreter already computes, so a runner just evaluates the file and reads each assert's result.
// This module is the pure half: discover the assert forms in source (with spans, for the editor Test
// Explorer) and classify evaluation results into pass/fail/error. The evaluation itself (guarded, worker
// isolated) is wired in the adapters.

import { parseCst, type SpannedNode, standardTokenizer } from "@metta-ts/core";

// Every assert form the core stdlib recognises. Each reduces to () when it holds and to (Error ...) otherwise.
export const ASSERT_HEADS: ReadonlySet<string> = new Set([
  "assertEqual",
  "assertEqualMsg",
  "assertEqualToResult",
  "assertEqualToResultMsg",
  "assertAlphaEqual",
  "assertAlphaEqualMsg",
  "assertAlphaEqualToResult",
  "assertAlphaEqualToResultMsg",
  "assertEqOp",
  "assertIncludes",
]);

const TOKENIZER = standardTokenizer();

// The head symbol of a rendered form like "(assertEqual (+ 1 1) 2)", or "" when it is not a headed list.
export function headOf(form: string): string {
  const match = /^\(\s*([^\s()]+)/.exec(form);
  return match?.[1] ?? "";
}

export interface DiscoveredTest {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

// The assert forms in a document, in source order, each a runnable test. A bang prefix is required: a bare
// (assertEqual ...) is data added to the space, not an executed test.
export function discoverTests(src: string): DiscoveredTest[] {
  const cst = parseCst(src, TOKENIZER);
  const tests: DiscoveredTest[] = [];
  for (const node of cst.nodes) {
    if (node.kind !== "expr" || node.bang !== true) continue;
    const head: SpannedNode | undefined = node.children?.[0];
    if (head?.kind === "symbol" && ASSERT_HEADS.has(src.slice(head.span.start, head.span.end)))
      tests.push({
        name: src.slice(node.span.start, node.span.end),
        start: node.span.start,
        end: node.span.end,
      });
  }
  return tests;
}

export type TestStatus = "pass" | "fail" | "error";

export interface TestResult {
  readonly name: string;
  readonly status: TestStatus;
  // On failure, the interpreter's (Error ...) atom; on an unexpected result, that result.
  readonly message?: string;
}

// One evaluated bang form: its rendered source and the atoms it reduced to.
export interface EvaluatedQuery {
  readonly query: string;
  readonly results: readonly string[];
}

// Classify each evaluated assert form: unit-only is a pass, any (Error ...) is a fail, and anything else (an
// unreduced form, an empty result set) is an error the author should see rather than a silent pass.
export function classifyTestQueries(queries: readonly EvaluatedQuery[]): TestResult[] {
  const results: TestResult[] = [];
  for (const query of queries) {
    if (!ASSERT_HEADS.has(headOf(query.query))) continue;
    const error = query.results.find((result) => result.startsWith("(Error"));
    if (error !== undefined) {
      results.push({ name: query.query, status: "fail", message: error });
    } else if (query.results.length > 0 && query.results.every((result) => result === "()")) {
      results.push({ name: query.query, status: "pass" });
    } else {
      results.push({
        name: query.query,
        status: "error",
        message: `unexpected result: ${query.results.join(" | ") || "(no result)"}`,
      });
    }
  }
  return results;
}

export interface TestSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
}

export function summarize(results: readonly TestResult[]): TestSummary {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    errored: results.filter((result) => result.status === "error").length,
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// A JUnit XML report of the test results, for CI systems (Jenkins, GitLab, and the rest) that consume it. A
// failed assert becomes a `<failure>`, an unexpected result an `<error>`, each carrying the interpreter's
// message.
export function toJUnitXml(results: readonly TestResult[], suiteName = "metta"): string {
  const summary = summarize(results);
  const cases = results.map((result) => {
    const name = escapeXml(result.name);
    if (result.status === "pass") return `    <testcase name="${name}" />`;
    const tag = result.status === "fail" ? "failure" : "error";
    return `    <testcase name="${name}">\n      <${tag} message="${escapeXml(result.message ?? result.status)}" />\n    </testcase>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${String(summary.total)}" failures="${String(summary.failed)}" errors="${String(summary.errored)}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${String(summary.total)}" failures="${String(summary.failed)}" errors="${String(summary.errored)}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
  ].join("\n");
}
