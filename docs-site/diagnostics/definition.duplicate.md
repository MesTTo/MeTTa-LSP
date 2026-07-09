# Duplicate definition

`definition.duplicate`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Duplicate <kind> definition '<name>' with arity N.`

## What it means

Two top-level definitions share the same name and arity. In `local` mode this is per file; in `global` mode it spans the workspace.

## Why it happens

The same function head is defined twice with the same number of parameters, often a copy-paste or a redefinition that should have been a new clause with a different pattern.

## How to fix it

Remove the duplicate, or make the patterns distinct (different arity or a more specific left side) so they are genuinely separate rules.

```metta
(= (f $x) $x)
(= (f $x) 0)     ; definition.duplicate: same name and arity
```

Controlled by the `metta.diagnostics.duplicateDefinitions` setting.
