# Lint rules

The linter ships a small pack of built-in rules and reads project rules from a `lint.metta` file. Each rule
has an id you can raise, lower, or turn off per project. The built-in pack:

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

| Rule | Default | What it flags |
| --- | --- | --- |
| `constant-if-true` | warn | The condition is always `True`, so the `if` reduces to the then-branch. |
| `constant-if-false` | warn | The condition is always `False`, so the `if` reduces to the else-branch. |
| `if-same-branches` | warn | Both branches of the `if` are identical, so the condition does not matter. |
| `if-true-false` | warn | `(if c True False)` is just `c`. |
| `superposed-empty` | warn | `(superpose ())` is equivalent to `(empty)`. |
| `superposed-single` | warn | `superpose` with a single value is redundant; it fans out one branch. |
| `duplicate-binder` | warn | A `let` binds the same variable twice, which is an equality constraint, not a fresh binding. |
| `missing-type-declaration` | off | A function has no `(: ...)` type declaration. Off by default; a declared type speeds interpretation. |

## Configuring rules

A `lint.metta` file at or above a source file sets per-rule severity and adds project rules. Severities are
`deny` (error), `warn`, or `off`:

```metta
(lint-severity constant-if-true off)
(lint-severity missing-type-declaration warn)
```

The semantic rules (`missing-recursive-type`, `inconsistent-arity`) parse inert definitions and ignore bang
forms. They run only when `metta.diagnostics.semanticLint` is on, since they are an extra background pass.

## Project rules

Project rules are structural patterns over source code. They are written in the same MeTTa syntax as the code
they match, but the rule file is parsed as data and is not evaluated.

```metta
(lint-rule no-debug
  (pattern (debug! $X))
  (message "leftover debug! around {$X}")
  (severity warn)
  (fix $X))
```

Captures are source spans. `$X` captures one subterm, `$$$Args` captures a run of arguments, and `$_` matches
one subterm without capturing it. Reusing the same capture name requires the same source text.

You can refine a rule with constraints:

```metta
(lint-rule capitalized-function-name
  (pattern (= ($Name $$$Args) $$$Body))
  (metavariable-regex $Name "^[A-Z]")
  (message "function {$Name} starts with a capital letter"))
```

`metavariable-regex` applies a JavaScript regular expression to the captured source text. Matching is anchored
at the start, like Semgrep's `metavariable-regex`: use `.*` when you want to allow a prefix. String captures
include their quotes because the matcher works on source text.
