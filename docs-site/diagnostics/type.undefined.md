# Undefined type in a signature

`type.undefined`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Undefined type '<T>' in signature for '<name>'.`

## What it means

A `(: ...)` signature names a type that is neither a standard type nor declared or imported.

## Why it happens

The type name is misspelled, or the module declaring it is not imported.

## How to fix it

Use a known type, declare the type, or import the module that defines it.

```metta
(: f (-> Numbr Number))   ; type.undefined: 'Numbr'
```

Controlled by the `metta.diagnostics.undefinedTypes` setting.
