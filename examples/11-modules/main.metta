; ─────────────────────────────────────────────────────────────────────────────
; 11 — Modules (the importer)
;
;   import!            bring another file's definitions into scope
;   (library <name>)   resolve a named library from a conventional lib/ directory
;   Go to Definition   (F12) on square / circle-area jumps into geometry.metta
;   Find references    (Shift+F12) spans both files
; ─────────────────────────────────────────────────────────────────────────────

; Import the sibling geometry module by its bare name — no quotes, no .metta. The
; leading ! runs the import; a bare (import! …) without it is inert data. The
; server resolves the name to geometry.metta and loads its definitions.
!(import! &self geometry)

; square and circle-area now resolve across the file boundary. Hover them for the
; type and docs the interpreter reports, or press F12 to jump into geometry.metta.
; They are not flagged as undefined, because the import brought them into scope,
; and Run evaluates them for real — 81 and 75.
!(square 9)
!(circle-area 5)

; PeTTa's (library <name>) form resolves a named library from the module search
; path — here the conventional lib/ directory. The server finds vectors by name in
; lib/vectors.metta, so vec-len-sq resolves across the boundary and Run gives 25.
!(import! &self (library vectors))
!(vec-len-sq 3 4)
