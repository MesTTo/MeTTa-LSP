; ─────────────────────────────────────────────────────────────────────────────
; 09 — Formatting
;
; This file is deliberately messy but valid. Run "Format Document" (or enable
; format on save / on type) and watch it reflow: consistent indentation, aligned
; clauses, and normalised spacing. The formatter is width-driven (Wadler-Leijen),
; so a long form breaks across lines while a short one stays inline.
; ─────────────────────────────────────────────────────────────────────────────

(:   messy   (->  Number   Number))
(=(messy $x)(+ $x    1))


(= (long-form $a $b $c $d)
(if (and (> $a 0) (> $b 0)) (+ $a (+ $b (+ $c $d))) 0))

!(   messy   41   )
