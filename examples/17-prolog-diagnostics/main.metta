; -----------------------------------------------------------------------------
; 17 -- Prolog bridge diagnostics
;
; The Prolog check is read-only. The LSP asks SWI-Prolog to parse referenced
; `.pl` files and reports parser diagnostics on the MeTTa path literal. It does
; not consult or execute the Prolog file.
;
; Requirements:
;   swipl on PATH
;   metta.diagnostics.prolog enabled
;
; What to look for:
;   `bad-facts.pl` has a deliberate syntax error.
;   `missing.pl` demonstrates prolog.unresolved.
;   Toggle Prolog diagnostics from "MeTTa: Settings" to hide/show this surface.
; -----------------------------------------------------------------------------

; Valid Prolog file. No diagnostic should appear on this path.
!(import! &self "facts.pl")

; Deliberately invalid Prolog file. The squiggle appears on the quoted path.
!(import! &self "bad-facts.pl")

; The same checker runs for bridge imports that name predicates explicitly.
!(import_prolog_functions_from_file "bad-facts.pl" (edge))

; Missing file diagnostic.
!(prolog-consult "missing.pl")
