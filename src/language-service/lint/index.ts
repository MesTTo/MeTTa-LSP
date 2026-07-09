// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Public entry to the syntactic linter: lint a document with the built-in rules plus any project rules,
// applying per-rule severity overrides from lint.metta.

import type { LintSeverity } from "../config.js";
import { BUILTIN_LINT_RULES } from "./builtinRules.js";
import {
  applyRules,
  applyRulesTracked,
  type LintFinding,
  type LintResult,
  type LintRule,
} from "./rule.js";

export * from "./builtinRules.js";
export * from "./pattern.js";
export * from "./rule.js";
export * from "./semantic.js";
export * from "./semanticRules.js";

export interface LintOptions {
  // Project-defined rules, parsed from (lint-rule ...) forms in lint.metta.
  readonly extraRules?: readonly LintRule[];
  // Per-rule severity overrides, from (lint-severity <rule> <level>) in lint.metta.
  readonly severities?: Readonly<Record<string, LintSeverity>>;
}

function rulesFor(options: LintOptions): LintRule[] {
  const severities = options.severities ?? {};
  return [...BUILTIN_LINT_RULES, ...(options.extraRules ?? [])].map((rule) => {
    const override = severities[rule.id];
    return override === undefined ? rule : { ...rule, severity: override };
  });
}

export function lintDocument(docSrc: string, options: LintOptions = {}): LintFinding[] {
  return applyRules(rulesFor(options), docSrc);
}

// Lint a document, returning both the findings and the ones a `; @suppress` directive silenced, so the
// analyzer can report suppressed lint rules in its transparency surfaces.
export function lintDocumentTracked(docSrc: string, options: LintOptions = {}): LintResult {
  return applyRulesTracked(rulesFor(options), docSrc);
}
