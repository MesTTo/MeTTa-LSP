; ─────────────────────────────────────────────────────────────────────────────
; 05 — Lint rules and suppression
;
; This folder has its own lint.metta (open it). It enables the opt-in
; missing-type-declaration rule, adds project rules, and declares a code-as-data
; (suppress (legacy $$$) symbol.possibleTypo).
;
; From the command line, `metta-lsp check demo.metta --show-suppressed` lists
; everything a directive or rule is hiding, and the reason for each.
; ─────────────────────────────────────────────────────────────────────────────

; Built-in rules fire as warnings, each with a lightbulb quick-fix. Try them:
!(if True 1 2)        ; constant-if-true → the fix reduces it to the then-branch
!(superpose ())       ; superposed-empty → the fix rewrites it to (empty)
!(if $c True False)   ; if-true-false → the fix reduces it to $c

; The project no-debug rule from lint.metta, with its autofix:
!(debug! (+ 1 2))

; The capitalized-function-name rule uses (metavariable-regex $Func "^[A-Z]")
; to filter the function head capture.
(: BadHelper (-> Number Number))
(= (BadHelper $x) $x)

; missing-type-declaration (opt-in) warns on this untyped function; the lightbulb
; also offers to add its (: helper (-> ...)) declaration.

; Doubles a number.
(= (helper $x) (* $x 2))

; Inline suppression. An unknown head is data in MeTTa, but a near-miss of a known name
; is flagged as a possible typo — this (cdr-atomm ...) is one edit from cdr-atom...
!(cdr-atomm 1)
; ...but the identical call below is silenced by the directive above it. Hover the
; directive to see exactly what it hides.
; @suppress symbol.possibleTypo
!(cdr-atomm 2)

; Code-as-data suppression: symbol.possibleTypo is silenced inside any (legacy ...)
; form, so the near-miss (car-atomm ...) wrapped below is not flagged...
!(legacy (car-atomm 3))
; ...while the same near-miss outside a legacy wrapper still is.
!(car-atomm 4)
