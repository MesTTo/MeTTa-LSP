<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: Apache-2.0
-->

# Playground

Edit the program and press **Run**. It evaluates in your browser with no server, which makes this page a quick way to test examples before trying them through the editor commands. Atoms without a leading `!` are added to the space; atoms with `!` are evaluated and their results shown.

<MettaRunner>

```metta
; rules are equalities; this one is recursive
(= (fact $n) (if (> $n 0) (* $n (fact (- $n 1))) 1))
!(fact 5)

; nondeterminism: two rules, two results
(= (bin) 0)
(= (bin) 1)
!(bin)

; pattern matching over stored facts
(parent Tom Bob)
(parent Tom Liz)
!(match &self (parent Tom $c) $c)
```

</MettaRunner>

Try changing `5` to `10`, or add another `(parent ...)` fact and re-run the query. Everything you can write in a `.metta` file works here.
