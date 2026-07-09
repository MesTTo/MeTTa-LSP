# Free variable in a body

`variable.undefined`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Undefined variable '<name>'.`

## What it means

A variable appears in a function body without being bound by the left side, a `let`, or a `match`. Off by default, since many MeTTa programs use free logic variables intentionally.

## Why it happens

A typo in a variable name, or a variable that was meant to be bound by the pattern.

## How to fix it

Bind the variable on the left side or in a `let`/`match`, or turn the check off if the free variable is intentional.

```metta
(= (f $x) (+ $x $y))   ; variable.undefined: $y is free
```

Controlled by the `metta.diagnostics.undefinedVariables` setting.
