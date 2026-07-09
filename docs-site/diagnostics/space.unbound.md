# Unbound atom-space symbol

`space.unbound`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Unbound atom-space symbol '<name>'.`

## What it means

A named space such as `&kb` is referenced but never bound with `bind!` or `new-space`.

## Why it happens

The space name is misspelled, or the `bind!` that creates it is missing or out of scope.

## How to fix it

Bind the space before use, `!(bind! &kb (new-space))`, or reference the correct name (`&self` for the current space).

```metta
!(match &kb ($x) $x)   ; space.unbound: &kb was never bound
```

Controlled by the `metta.diagnostics.unboundSpaces` setting.
