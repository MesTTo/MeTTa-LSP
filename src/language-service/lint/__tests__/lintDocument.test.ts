// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The public lint entry: built-in rules fire out of the box, severity overrides disable or promote them, and
// project rules join the set.

import { describe, expect, it } from "vitest";
import { BUILTIN_LINT_RULES, lintDocument, parseRules } from "../index.js";

describe("lintDocument", () => {
  it("ships a parseable built-in rule set", () => {
    expect(BUILTIN_LINT_RULES.length).toBeGreaterThan(0);
  });

  it("fires a built-in rule with its autofix", () => {
    const findings = lintDocument("(if True yes no)");
    const hit = findings.find((f) => f.ruleId === "constant-if-true");
    expect(hit).toBeDefined();
    expect(hit?.fix?.newText).toBe("yes");
  });

  it("flags a redundant single superpose", () => {
    const findings = lintDocument("(superpose (only))");
    expect(findings.map((f) => f.ruleId)).toContain("superposed-single");
  });

  it("flags identical if branches without offering an unsafe fix", () => {
    const findings = lintDocument("(if (p) yes yes)");
    const hit = findings.find((f) => f.ruleId === "if-same-branches");
    expect(hit).toBeDefined();
    expect(hit?.fix).toBeUndefined();
  });

  it("simplifies (if c True False) to c", () => {
    const findings = lintDocument("(if (positive $n) True False)");
    const hit = findings.find((f) => f.ruleId === "if-true-false");
    expect(hit?.fix?.newText).toBe("(positive $n)");
  });

  it("does not fire the off-by-default missing-type rule until enabled", () => {
    const doc = "(= (foo $x) $x)";
    expect(lintDocument(doc).some((f) => f.ruleId === "missing-type-declaration")).toBe(false);
    const enabled = lintDocument(doc, { severities: { "missing-type-declaration": "warn" } });
    expect(enabled.some((f) => f.ruleId === "missing-type-declaration")).toBe(true);
  });

  it("silences a built-in rule via a severity override", () => {
    const findings = lintDocument("(if True yes no)", {
      severities: { "constant-if-true": "off" },
    });
    expect(findings.some((f) => f.ruleId === "constant-if-true")).toBe(false);
  });

  it("runs a project-defined rule alongside the built-ins", () => {
    const { rules } = parseRules(
      '(lint-rule no-todo (pattern (TODO $$$)) (message "left a TODO"))',
    );
    const findings = lintDocument("(TODO fix this)", { extraRules: rules });
    expect(findings.some((f) => f.ruleId === "no-todo")).toBe(true);
  });
});
