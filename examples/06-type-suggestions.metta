; ─────────────────────────────────────────────────────────────────────────────
; 06 — Type-declaration suggestions
;
; Put your cursor on an untyped function definition and open the lightbulb (the
; code-action menu). The server offers "Add type declaration", scaffolding a
; (: name (-> ...)) line from the argument and return shapes for you to narrow.
;
; This is not just tidiness: declaring a function's type lets the interpreter
; dispatch by type instead of trying every rule, so a typed function reduces
; faster.
; ─────────────────────────────────────────────────────────────────────────────

; Put your cursor on an untyped definition below and open the lightbulb → "Add
; type declaration". `double` and `scale` are untyped; `triple` already has its.

;; Doubles a number.
(= (double $x) (* $x 2))

;; Scales a value by a factor.
(= (scale $factor $value) (* $factor $value))

;; Triples a number.
(: triple (-> Number Number))
(= (triple $x) (* $x 3))

!(double 21)
!(triple 14)
