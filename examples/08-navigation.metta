; ─────────────────────────────────────────────────────────────────────────────
; 08 — Navigation
;
;   Go to definition   (F12 / gd)      on a call, jump to its (= ...) clause
;   Find references    (Shift+F12)     every use of the symbol under the cursor
;   Rename             (F2)            rename a symbol and all references at once
;   Call hierarchy                     who calls this, and what it calls
;   Completion                         start typing a defined name, then accept
; ─────────────────────────────────────────────────────────────────────────────

;; The square of a number.
(: square (-> Number Number))
(= (square $x) (* $x $x))

;; The sum of the squares of two numbers.
(: sum-of-squares (-> Number Number Number))
(= (sum-of-squares $a $b) (+ (square $a) (square $b)))

; `square` is used twice above. Put the cursor on it and Find References, or
; Rename it — both clauses and both call sites update together.
!(sum-of-squares 3 4)

; Open the call-hierarchy view on `hypotenuse` to walk the chain
; hypotenuse → sum-of-squares → square.

;; The hypotenuse of a right triangle with legs $a and $b.
(: hypotenuse (-> Number Number Number))
(= (hypotenuse $a $b) (sqrt-approx (sum-of-squares $a $b)))

;; A stand-in square root (identity here) to keep the example self-contained.
(= (sqrt-approx $n) $n)

!(hypotenuse 3 4)
