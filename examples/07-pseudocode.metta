; ─────────────────────────────────────────────────────────────────────────────
; 07 — Pseudocode (mixfix) mode
;
; Turn on metta.pseudocode.enabled (or use the settings quick-pick in the status
; bar). A faint "≡ ..." line appears above each top-level form, rendering it in
; mixfix notation — the readable, operator-style reading of the S-expression.
; It is a reading aid; it does not change what runs.
; ─────────────────────────────────────────────────────────────────────────────

; The area of a $w by $h rectangle.
(= (area $w $h) (* $w $h))
; A $price reduced by a fractional $rate.
(= (discount $price $rate) (- $price (* $price $rate)))
; $x confined to the range [$lo, $hi].
(= (clamp $x $lo $hi) (if (< $x $lo) $lo (if (> $x $hi) $hi $x)))

!(area 3 4)
!(discount 100 0.2)
!(clamp 12 0 10)
