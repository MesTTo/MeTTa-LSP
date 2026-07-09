; ─────────────────────────────────────────────────────────────────────────────
; 01 — Hovers
;
; Hover any symbol below (mouse over it, or press K with a Vim keymap). You get
; a rust-analyzer-style card: the signature, the interpreter-exact type, where
; it is defined, and — for standard functions — a "Open docs" link.
; ─────────────────────────────────────────────────────────────────────────────

; Hover a builtin: signature, documentation, and the docs link.
!(println! "hover println! to see its card")

; Hover the operators. Each one shows its arithmetic/relational signature.
!(+ 2 (* 3 4))
!(if (> 10 5) "bigger" "smaller")

; A typed function of your own. Hover `factorial` at the call and at the
; definition: the card shows (-> Number Number) and the definition site.

;; The factorial of n. One clause guards the base case with `if`: a separate
;; (= (factorial 0) 1) would also match (factorial $n) in MeTTa and recurse into
;; negatives forever, so the `if` keeps it to a single path.
(: factorial (-> Number Number))
(= (factorial $n) (if (< $n 1) 1 (* $n (factorial (- $n 1)))))

!(factorial 5)

; Hover the list builtins to see how they destructure and build expressions.
!(car-atom (1 2 3))
!(cons-atom 0 (1 2 3))

; Hover `match` and `superpose` — the nondeterministic core of MeTTa.
!(superpose (1 2 3))
