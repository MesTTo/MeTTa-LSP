// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The built-in syntactic lint rules, authored in the same MeTTa-native format a project uses in lint.metta.
// These are the checks decidable from source structure alone (no interpreter), each low-noise and, where a
// mechanical rewrite exists, carrying an autofix. Rule ids and wording follow the user's MeTTaDevPack lint
// module so a project sees one vocabulary across the syntactic and semantic linters. The semantic rules that
// need the atomspace (type checks, reachability) live in the runtime-backed linter, not here.
//
// missing-type-declaration ships off by default: an undeclared function is legal MeTTa, so firing it broadly
// is noise. A project opts in with (lint-severity missing-type-declaration warn) in lint.metta.

import { type LintRule, parseRules } from "./rule.js";

const BUILTIN_RULES_SRC = `
(lint-rule constant-if-true
  (pattern (if True $Then $Else))
  (message "the condition is always True, so this reduces to the then-branch")
  (severity warn)
  (fix $Then))

(lint-rule constant-if-false
  (pattern (if False $Then $Else))
  (message "the condition is always False, so this reduces to the else-branch")
  (severity warn)
  (fix $Else))

(lint-rule superposed-empty
  (pattern (superpose ()))
  (message "(superpose ()) is equivalent to (empty)")
  (severity warn)
  (fix (empty)))

(lint-rule superposed-single
  (pattern (superpose ($Value)))
  (message "superpose with a single value is redundant; it fans out one branch")
  (severity warn)
  (fix $Value))

(lint-rule duplicate-binder
  (pattern (let ($Var $Var) $Value $Body))
  (message "let binds the same variable twice; this is an equality constraint, not a fresh binding")
  (severity warn))

(lint-rule if-same-branches
  (pattern (if $Cond $Same $Same))
  (message "both branches of this if are identical")
  (severity warn))

(lint-rule if-true-false
  (pattern (if $Cond True False))
  (message "(if c True False) is just c")
  (severity warn)
  (fix $Cond))

(lint-rule missing-type-declaration
  (pattern (= ($Func $$$) $$$))
  (not-in-file (: $Func $$$))
  (message "function {$Func} has no type declaration")
  (severity off))
`;

const parsed = parseRules(BUILTIN_RULES_SRC);

// A build-time guarantee: the shipped rule text must parse cleanly. A typo here is a bug, not a user error.
if (parsed.issues.length > 0) {
  throw new Error(`built-in lint rules failed to parse: ${parsed.issues[0]?.message ?? "unknown"}`);
}

export const BUILTIN_LINT_RULES: readonly LintRule[] = parsed.rules;
