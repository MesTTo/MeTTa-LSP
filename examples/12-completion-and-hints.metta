; ─────────────────────────────────────────────────────────────────────────────
; 12 — Completion, signature help, and inlay hints
;
;   Completion       start typing a name; accept a defined symbol or a builtin
;   Signature help   inside a call's parens, see the parameter list as you type
;   Inlay hints      inferred types shown inline (toggle metta.inlayHints.enabled)
; ─────────────────────────────────────────────────────────────────────────────

; A typed helper, so completion and signature help have something to describe.
(: scale (-> Number Number Number))
(= (scale $factor $x) (* $factor $x))

; Completion: on a new line type  !(sc  and press Ctrl+Space. `scale` is offered
; with its (-> Number Number Number) type, alongside any builtin that matches.

; Signature help: start a fresh call, type  !(scale   and the parameter list
; ($factor $x) appears and tracks which argument you are on as you fill it in.
!(scale 3 7)

; Inlay hints: with metta.inlayHints.enabled on, an inferred type is shown inline
; where the source leaves it implicit. Nothing to click; the hint renders in place.
(= (triple $x) (scale 3 $x))
!(triple 4)
