; ─────────────────────────────────────────────────────────────────────────────
; 11 — Modules (a PeTTa (library …) file)
;
; A small vectors library, found by name from a conventional lib/ directory.
; main.metta imports it as (library vectors); the server resolves that to this
; file, so Go to Definition on vec-len-sq jumps here and Find References spans
; both files.
; ─────────────────────────────────────────────────────────────────────────────

;; The squared length of a 2D vector — kept squared to stay integer-friendly.
(: vec-len-sq (-> Number Number Number))
(= (vec-len-sq $x $y) (+ (* $x $x) (* $y $y)))
