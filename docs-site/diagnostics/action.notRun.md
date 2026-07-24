# Action does not run without a leading !

`action.notRun`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`This <op> does not run: without a leading !, a top-level form is inert data, and <op> exists for its effect, so nothing happens at runtime. Prefix it with ! to run it.`

## What it means

MeTTa evaluates a top-level form only when it carries a leading `!`. Every other form is added to the space as data, which is exactly what you want for a fact or a rule.

It is not what you want for an op that exists for its effect. The standard library declares those with the unit return type `(->)`: the assert family, `add-atom`, `remove-atom`, `add-reduct`, `println!`, `print!`. Such an op returns nothing a later query can match, so storing the call achieves nothing. The assertion never checks, the `add-atom` never adds, the `println!` never prints, and nothing reports it.

That silence is the danger. An unbanged `assertEqualToResult` in a test file looks exactly like a test that passes.

## Why it happens

The `!` is left off, or it ends up bound to something else. A bang binds to the next form across comments, so this runs:

```metta
;; check the retraction
!(assertEqualToResult (retract-source claim) (()))
```

but a second stray `!` takes the bang for itself, leaving the assertion inert:

```metta
!;; check the retraction
!
(assertEqualToResult (retract-source claim) (()))   ; never runs
```

## How to fix it

Add the leading `!` so the form runs. The quick fix does this.

```metta
(assertEqual (+ 1 1) 2)    ; inert data — the assertion never checks
!(assertEqual (+ 1 1) 2)   ; runs — a failure is reported
```

An op you declare yourself is covered on the same footing, because the check reads the return type from the interpreter rather than from a list of builtin names:

```metta
(: log-fact (-> Atom (->)))
(log-fact (likes Sam pizza))    ; flagged: log-fact returns the unit type
```

A bare `(import! …)` has its own diagnostic, [`import.notRun`](/diagnostics/import.notRun), whose message names the module whose symbols stay undefined.

Controlled by the `metta.diagnostics.actionNotRun` setting.
