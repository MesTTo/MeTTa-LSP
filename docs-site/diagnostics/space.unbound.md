# Unbound atom-space symbol

`space.unbound`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Unbound atom-space symbol '<name>'.`

## What it means

A named space such as `&kb` is referenced but never bound. `bind!` creates a
token explicitly. A running `import!` also binds its first argument to the
imported module space.

## Why it happens

The space name is misspelled, or the `bind!` or running `import!` that creates
it is missing or out of scope.

## How to fix it

Bind the space before use, import a module into that token, or reference the
correct name. Use `&self` for the current space.

```metta
!(match &kb ($x) $x)   ; space.unbound: &kb was never bound
```

Both forms below make a token available:

```metta
!(bind! &kb (new-space))
!(import! &module-kb knowledge)
```

Controlled by the `metta.diagnostics.unboundSpaces` setting.
