# Wrong number of arguments

`call.arity`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`<function> expects N arguments, got M.`

## What it means

A call passes a different number of arguments than the function's signature or its indexed definition takes.

## Why it happens

The signature `(: f (-> A B C))` declares two parameters, but the call `(f 1)` passes one.

## How to fix it

Pass the declared number of arguments, or update the signature and definitions if the arity changed.

```metta
(: add (-> Number Number Number))
(add 1)        ; call.arity: expects 2, got 1
```

Controlled by the `metta.diagnostics.arity` setting.
