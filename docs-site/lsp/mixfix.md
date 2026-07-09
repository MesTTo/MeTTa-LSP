# Mixfix pseudocode

MeTTa is written in prefix S-expressions: `(+ 1 2)`, `(if (> $n 0) $n 0)`. Mixfix pseudocode renders the
same forms the way you would read them aloud, with operators between their arguments and functions applied
to parenthesised arguments: `1 + 2`, `fact(5)`.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

Turn on **pseudocode mode** (the settings quick-pick, or `metta.pseudocode.enabled`) and the server shows
each top-level form's mixfix reading as a code lens above it, so you see the meaning of every line without
rearranging the parentheses in your head:

```metta
(= (fact $n) (* $n (fact (- $n 1))))
; ≡ fact($n) = $n * fact($n - 1)

!(fact 5)
; ≡ fact(5)
```

The rendering is notation, not English: an infix operator reads infix, a known mixfix form (like `if`)
reads in its mixfix shape, and everything else is function application. It is the same projection the
**Explain form** command uses, so clicking a pseudocode lens opens the fuller reading.
