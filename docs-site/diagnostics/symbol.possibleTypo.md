# Possible typo in a call head

`symbol.possibleTypo`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`'<name>' is not a known function; did you mean '<suggestion>'? (An unknown symbol is treated as data in MeTTa.)`

## What it means

An unknown head is valid data in MeTTa: it reduces to itself, and a definition may still be added later, so it is never an error. This is a **hint**, not a warning. It fires only when the head is a close match (bounded Levenshtein distance) of a name you could have meant, so it most likely is a typo.

## Why it happens

The name is misspelled, close to a builtin, a function you defined, or a visible imported symbol.

## How to fix it

Apply the suggestion (the quick fix rewrites the head to the suggested name). If the head really is data, leave it: the hint does not change how the program evaluates.

```metta
(car-atomm (1 2))   ; symbol.possibleTypo: did you mean 'car-atom'?
```

Controlled by the `metta.diagnostics.undefinedFunctions` setting.
