# Argument type mismatch

`call.typeMismatch`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Type mismatch for '<name>' argument K: expected <T>, got <U>.`

## What it means

A literal argument's type does not match the parameter type the function's signature declares.

## Why it happens

`(: not (-> Bool Bool))` declares a Bool parameter, but `(not 1)` passes a Number literal.

## How to fix it

Pass a value of the declared type, or widen the signature (e.g. to `Atom`) if the function is polymorphic.

```metta
(: not (-> Bool Bool))
(not 1)        ; call.typeMismatch: expected Bool, got Number
```

Controlled by the `metta.diagnostics.typeMismatch` setting.
