; ─────────────────────────────────────────────────────────────────────────────
; 11 — Modules (a library file)
;
; A small geometry library. main.metta imports it; from there, Go to Definition
; on `square` or `circle-area` jumps back into this file, and Find References
; spans both files.
; ─────────────────────────────────────────────────────────────────────────────

;; The square of a number.
(: square (-> Number Number))
(= (square $x) (* $x $x))

;; The area of a circle, with a deliberately rough pi to keep it integer-friendly.
(: circle-area (-> Number Number))
(= (circle-area $r) (* 3 (square $r)))
