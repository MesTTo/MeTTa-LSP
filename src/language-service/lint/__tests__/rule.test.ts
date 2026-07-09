// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The rule engine: parsing (lint-rule ...) forms, matching them over a document, interpolating captures into
// messages, rendering fix templates, and the relational constraints (not-in-file / has / not-has).

import { describe, expect, it } from "vitest";
import { applyRules, applyRulesTracked, parseRules, patternSuppressionSpans } from "../rule.js";

// Parse rules then lint a document in one step.
function lint(rulesSrc: string, docSrc: string) {
  const { rules, issues } = parseRules(rulesSrc);
  expect(issues).toEqual([]);
  return applyRules(rules, docSrc);
}

describe("rule parsing", () => {
  it("parses a rule's fields", () => {
    const { rules } = parseRules(
      '(lint-rule r (pattern (if True $T $E)) (message "always true") (severity deny) (fix $T))',
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe("r");
    expect(rules[0]?.severity).toBe("deny");
    expect(rules[0]?.fix).toBeDefined();
  });

  it("defaults severity to warn and reports a rule missing its pattern", () => {
    const warn = parseRules('(lint-rule r (pattern (a)) (message "m"))');
    expect(warn.rules[0]?.severity).toBe("warn");
    const bad = parseRules('(lint-rule r (message "m"))');
    expect(bad.rules).toHaveLength(0);
    expect(bad.issues[0]?.message).toContain("needs a (pattern");
  });
});

describe("rule application", () => {
  const constantIfTrue =
    '(lint-rule constant-if-true (pattern (if True $Then $Else)) (message "condition is always true, reduces to {$Then}") (severity warn) (fix $Then))';

  it("finds a match and locates it at the matched node's span", () => {
    const doc = "(foo)\n(if True a b)";
    const findings = lint(constantIfTrue, doc);
    expect(findings).toHaveLength(1);
    expect(doc.slice(findings[0]?.start, findings[0]?.end)).toBe("(if True a b)");
  });

  it("interpolates a capture into the message", () => {
    const findings = lint(constantIfTrue, "(if True result other)");
    expect(findings[0]?.message).toBe("condition is always true, reduces to result");
  });

  it("renders a fix that replaces the match with the then-branch", () => {
    const findings = lint(constantIfTrue, "(if True (compute x) fallback)");
    expect(findings[0]?.fix?.newText).toBe("(compute x)");
  });

  it("does not fire for a severity of off or allow", () => {
    const off = '(lint-rule r (pattern (if True $T $E)) (message "m") (severity off))';
    expect(lint(off, "(if True a b)")).toHaveLength(0);
  });

  it("rewrites a redundant form via a structural fix template", () => {
    // (and $X True) is just $X
    const rule = '(lint-rule and-true (pattern (and $X True)) (message "redundant True") (fix $X))';
    const findings = lint(rule, "(and (p q) True)");
    expect(findings[0]?.fix?.newText).toBe("(p q)");
  });
});

describe("relational constraints", () => {
  const needsType =
    '(lint-rule needs-type (pattern (= ($F $$$) $$$)) (not-in-file (: $F $$$)) (message "function {$F} lacks a type declaration") (severity warn))';

  it("flags a definition with no matching type declaration", () => {
    const findings = lint(needsType, "(= (foo $x) $x)");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe("function foo lacks a type declaration");
  });

  it("suppresses the finding when a type declaration for the same head exists", () => {
    const findings = lint(needsType, "(: foo (-> Number Number))\n(= (foo $x) $x)");
    expect(findings).toHaveLength(0);
  });

  it("keeps flagging a different undeclared function alongside a declared one", () => {
    const doc = "(: foo (-> Number Number))\n(= (foo $x) $x)\n(= (bar $y) $y)";
    const findings = lint(needsType, doc);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("bar");
  });

  it("honors has and not-has over the matched subtree", () => {
    const hasRule =
      '(lint-rule calls-foo (pattern (= $H $B)) (has (foo $$$)) (message "body calls foo"))';
    expect(lint(hasRule, "(= (g $x) (foo $x))")).toHaveLength(1);
    expect(lint(hasRule, "(= (g $x) (bar $x))")).toHaveLength(0);
  });
});

describe("regex constraints", () => {
  it("filters a capture by its source text", () => {
    const rule =
      '(lint-rule capital-name (pattern (: $Name $Type)) (metavariable-regex $Name "^[A-Z]") (message "capitalized declaration {$Name}"))';
    const findings = lint(rule, "(: foo Type)\n(: Foo Type)");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe("capitalized declaration Foo");
  });

  it("supports regex as a short alias for metavariable-regex", () => {
    const rule =
      '(lint-rule no-debug-head (pattern ($Head $$$)) (regex $Head ".*debug") (message "debug-style head {$Head}"))';
    const findings = lint(rule, "(my-debug a)\n(debugger b)\n(trace c)");
    expect(findings.map((finding) => finding.message)).toEqual([
      "debug-style head my-debug",
      "debug-style head debugger",
    ]);
  });

  it("uses Semgrep-style left anchoring", () => {
    const anchored =
      '(lint-rule anchored (pattern (call $Name)) (metavariable-regex $Name "bar") (message "m"))';
    expect(lint(anchored, "(call foobar)")).toHaveLength(0);
    const prefix =
      '(lint-rule prefix (pattern (call $Name)) (metavariable-regex $Name ".*bar") (message "m"))';
    expect(lint(prefix, "(call foobar)")).toHaveLength(1);
  });

  it("filters named ellipsis captures", () => {
    const rule =
      '(lint-rule log-starts-with-a (pattern (log $$$Args)) (metavariable-regex $$$Args "a b") (message "log starts with a b"))';
    expect(lint(rule, "(log a b c)")).toHaveLength(1);
    expect(lint(rule, "(log z a b)")).toHaveLength(0);
  });

  it("does not fire when the regex target was never captured", () => {
    const rule =
      '(lint-rule missing-capture (pattern (foo $X)) (metavariable-regex $Other ".*") (message "m"))';
    expect(lint(rule, "(foo value)")).toHaveLength(0);
  });

  it("reports invalid regex constraints as rule schema issues", () => {
    const badRegex = parseRules(
      '(lint-rule bad (pattern (foo $X)) (metavariable-regex $X "[") (message "m"))',
    );
    expect(badRegex.rules).toHaveLength(0);
    expect(badRegex.issues[0]?.message).toContain("invalid regex");

    const badTarget = parseRules(
      '(lint-rule bad (pattern (foo $x)) (metavariable-regex $x ".*") (message "m"))',
    );
    expect(badTarget.rules).toHaveLength(0);
    expect(badTarget.issues[0]?.message).toContain("must name a capture");
  });
});

describe("suppression", () => {
  const rule = '(lint-rule r (pattern (if True $T $E)) (message "always true"))';

  it("suppresses a finding with a leading @suppress comment", () => {
    expect(lint(rule, "; @suppress r\n(if True a b)")).toHaveLength(0);
  });

  it("suppresses a finding with a trailing @suppress comment on the same line", () => {
    expect(lint(rule, "(if True a b) ; @suppress r")).toHaveLength(0);
  });

  it("only suppresses the named rule", () => {
    expect(lint(rule, "; @suppress other-rule\n(if True a b)")).toHaveLength(1);
  });

  it("suppresses everything on the line when no rule id is given", () => {
    expect(lint(rule, "; @suppress\n(if True a b)")).toHaveLength(0);
  });

  it("suppresses a rule file-wide with @suppress-file", () => {
    expect(lint(rule, "; @suppress-file r\n(if True a b)\n(if True c d)")).toHaveLength(0);
  });

  it("suppresses the whole file with a bare @suppress-file", () => {
    expect(lint(rule, "; @suppress-file\n(if True a b)\n(if True c d)")).toHaveLength(0);
  });

  it("does not suppress an unrelated line", () => {
    expect(lint(rule, "; @suppress r\n(foo)\n(if True a b)")).toHaveLength(1);
  });

  it("applyRulesTracked partitions the suppressed findings out", () => {
    const { rules } = parseRules(rule);
    const { findings, suppressed } = applyRulesTracked(
      rules,
      "(if True a b)\n; @suppress r\n(if True c d)",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.start).toBe(0);
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.ruleId).toBe("r");
  });
});

describe("suppress rules (code-as-data)", () => {
  it("parses (suppress <pattern> <codes...>) with the listed codes", () => {
    const { suppresses, issues } = parseRules(
      "(suppress (legacy $$$) symbol.possibleTypo call.arity)",
    );
    expect(issues).toEqual([]);
    expect(suppresses).toHaveLength(1);
    expect([...(suppresses[0]?.codes as ReadonlySet<string>)]).toEqual([
      "symbol.possibleTypo",
      "call.arity",
    ]);
  });

  it("treats a code-less (suppress <pattern>) as covering every code", () => {
    const { suppresses } = parseRules("(suppress (experimental $$$))");
    expect(suppresses[0]?.codes).toBe("all");
  });

  it("reports a suppress with no pattern", () => {
    const { suppresses, issues } = parseRules("(suppress symbol.possibleTypo)");
    expect(suppresses).toHaveLength(0);
    expect(issues[0]?.message).toContain("suppress needs a pattern");
  });

  it("computes the spans a pattern matches over a document", () => {
    const { suppresses } = parseRules("(suppress (legacy $$$) symbol.possibleTypo)");
    const spans = patternSuppressionSpans("(legacy a) (other b)", suppresses);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.start).toBe(0);
    expect(spans[0]?.end).toBe("(legacy a)".length);
  });
});
