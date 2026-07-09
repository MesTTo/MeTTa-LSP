// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The semantic lint rules, written in MeTTa and run by the interpreter over a space holding the program's
// definitions. Unlike the syntactic rules (pattern matching on the CST), these query the atomspace: which
// functions have a type declaration, which call themselves, which have clauses of differing arity. The rule
// bodies are lifted from the user's MeTTaDevPack lint module (rules/type_safety.metta), whose semantics were
// validated against @metta-ts/core.
//
// Three things had to change to run under core's strict evaluation, all confirmed empirically:
//   1. `(collapse (superpose (rule-calls)))` ANNIHILATES: core reduces the tuple strictly, so one rule
//      returning (empty) collapses the whole result to (). The fix is to superpose over rule NAME symbols
//      (which reduce to themselves) and dispatch through `apply-rule`, so an empty branch drops cleanly.
//   2. multi-clause functions yield one violation per clause; the runner dedups by (rule, symbol).
//   3. current core returns collapsed result sets as Hyperon comma tuples: `(,)` for no results and
//      `(, a b)` for results. `lint-result-payload` strips that comma marker so the rules can reason over
//      the payload list.

export const SEMANTIC_LINT_MODULE = `
(: LintViolation Type)
(: LintSeverity Type)
(: deny LintSeverity)
(: warn LintSeverity)
(: allow LintSeverity)
(: off LintSeverity)

(= (rule-default $rule)
  (case $rule
    ((missing-recursive-type deny)
     (inconsistent-arity deny)
     ($other warn))))

(= (lint-result-payload $xs)
  (case (get-metatype $xs)
    ((Expression
      (if (== $xs ())
        ()
        (let $head (car-atom $xs)
          (if (== $head ,) (cdr-atom $xs) $xs))))
     ($other $xs))))

(= (get-severity $space $rule)
  (let $matches (lint-result-payload (collapse (match $space (lint-severity $rule $level) $level)))
    (if (== $matches ()) (rule-default $rule) (car-atom $matches))))

(= (should-check $space $rule)
  (case (get-severity $space $rule)
    ((off False) (allow False) ($other True))))

(= (contains-symbol $name $expr)
  (case (get-metatype $expr)
    ((Symbol (== $name $expr))
     (Expression
       (if (== $expr ())
         False
         (let $head (car-atom $expr)
           (let $tail (cdr-atom $expr)
             (if (contains-symbol $name $head) True (contains-symbol $name $tail))))))
     ($other False))))

(= (check-missing-recursive-type $space)
  (if (should-check $space missing-recursive-type)
    (let $head (match $space (= $head $body) $head)
      (let $name (car-atom $head)
        (if (== (lint-result-payload (collapse (match $space (: $name $ty) $name))) ())
          (if (contains-symbol $name $body)
            (LintViolation missing-recursive-type (get-severity $space missing-recursive-type) $name
              "recursive function has no type declaration (exponential blowup risk)")
            (empty))
          (empty))))
    (empty)))

(= (check-inconsistent-arity $space)
  (if (should-check $space inconsistent-arity)
    (let $head (match $space (= $head $body) $head)
      (let $name (car-atom $head)
        (let $arity (- (size-atom $head) 1)
          (let $other (superpose (lint-result-payload (collapse (match $space (= $h2 $b2) $h2))))
            (if (== (car-atom $other) $name)
              (if (not (== $arity (- (size-atom $other) 1)))
                (LintViolation inconsistent-arity (get-severity $space inconsistent-arity) $name
                  "function has clauses with different arities")
                (empty))
              (empty))))))
    (empty)))

(= (apply-rule missing-recursive-type $space) (check-missing-recursive-type $space))
(= (apply-rule inconsistent-arity $space) (check-inconsistent-arity $space))

(= (lint-check-core $space)
  (collapse
    (apply-rule (superpose (missing-recursive-type inconsistent-arity)) $space)))
`;

// The rule ids this module can emit, for config validation and documentation.
export const SEMANTIC_RULE_IDS: readonly string[] = [
  "missing-recursive-type",
  "inconsistent-arity",
];
