// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Prove the ergonomic DSL against the compiled dist, where the guarded worker resolves: lint,
// diagnostics, format, and an actual evaluation through run(). Part of verify:strict.

import { diagnostics, format, lint, replace, run, search } from "../dist/dsl/index.js";

const fail = (message) => {
  console.error(`smoke-dsl: FAIL — ${message}`);
  process.exit(1);
};

const findings = lint("(= (f $x) (if True 1 2))");
if (!findings.some((f) => f.ruleId === "constant-if-true"))
  fail(`lint missed constant-if-true: ${JSON.stringify(findings)}`);

// An unknown head is data in MeTTa; a near-miss of a builtin gets a possible-typo hint.
const codes = diagnostics("(car-atomm (1 2))").map((d) => d.code);
if (!codes.includes("symbol.possibleTypo"))
  fail(`diagnostics missed symbol.possibleTypo: ${JSON.stringify(codes)}`);

if (!format("(=   (f   $x)   $x)").includes("(= (f $x) $x)"))
  fail("format did not normalize spacing");

const matches = search("(= (a) (if True 1 2))\n(= (b) (if True 3 4))", "(if True $T $E)");
if (matches.length !== 2) fail(`search expected 2 matches, got ${matches.length}`);

const rewritten = replace("(= (a $x) (if True $x 0))", "(if True $T $E)", "$T");
if (rewritten !== "(= (a $x) $x)") fail(`replace produced: ${rewritten}`);

const result = await run("(= (double $x) (* $x 2))\n!(double 21)");
const values = result.queries.flatMap((q) => q.results);
if (result.guarded !== true) fail(`expected guarded=true, got ${result.guarded}`);
if (!values.includes("42")) fail(`run did not evaluate to 42: ${JSON.stringify(values)}`);

console.log(
  `smoke-dsl: ok — lint/diagnostics/format/search/replace pass; run() => [${values.join(", ")}]`,
);
process.exit(0);
