# Variable name contains '#'

`variable.reservedHash`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Variable '<name>' contains '#', which is reserved in many MeTTa parsers.`

## What it means

A variable name includes `#`, which some MeTTa parsers reserve, so the program may not port cleanly.

## Why it happens

A `#` was included in a `$`-variable name.

## How to fix it

Rename the variable without `#`.

```metta
(= (f $x#1) $x#1)   ; variable.reservedHash
```

Controlled by the `metta.diagnostics.undefinedVariables` setting.
