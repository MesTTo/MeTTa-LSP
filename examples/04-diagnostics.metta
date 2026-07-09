; ─────────────────────────────────────────────────────────────────────────────
; 04 — Diagnostics catalogue
;
; Each block below deliberately triggers one diagnostic. Every code is
; underlined in the editor; hover the squiggle for the message, and click the
; code (or its "Open docs" link) for the catalogue page explaining the fix.
;
; Any diagnostic can be silenced inline with `; @suppress <code>` on the line
; above it — see 05-lint-and-suppression/ for that.
; ─────────────────────────────────────────────────────────────────────────────

; symbol.possibleTypo — an unknown head is data in MeTTa (it reduces to itself), so it
; is never an error. But when it is one edit away from a known name, that is probably a
; typo: (car-atomm ...) gets a "did you mean 'car-atom'?" hint.
(= (uses-typo $x) (car-atomm $x))

; type.undefined — a type name with no declaration.
(: widget NoSuchType)

; call.arity — a known signature called with the wrong number of arguments.
(: add2 (-> Number Number Number))
(= (add2 $a $b) (+ $a $b))
!(add2 1)

; call.typeMismatch — a literal of the wrong type for a declared parameter.
!(add2 "hello" 2)

; definition.duplicate — two definitions with the same name and arity.
(= (greet) "hi")
(= (greet) "hello")

; space.unbound — a named atom-space that is never bound.
!(match &missing ($x) $x)

; import.unresolved — importing a module that does not resolve.
!(import! &self no-such-module)

; import.notRun — without the leading !, the import form is inert data and the
; module's symbols are not loaded. The quick-fix adds the !.
(import! &self math)

; variable.reservedHash — a variable name containing '#', reserved in many MeTTa
; parsers.
(= (bad-hash $a#b) $a#b)

; variable.suspiciousSemicolon — a ';' immediately after a variable starts a
; comment, silently dropping the rest of the line (here, the closing paren moved
; to its own line so the form still parses).
(= (trap)
   $w;this tail is commented out
)

; variable.undefined is off by default (many MeTTa programs use free logic
; variables intentionally). Turn on metta.diagnostics.undefinedVariables to see
; `$y` flagged here.
(= (free-var $x) $y)
