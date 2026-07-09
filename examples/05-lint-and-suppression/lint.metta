; Project lint configuration for this folder. The language server finds the
; nearest lint.metta by walking up from each file, the way ESLint and Prettier
; cascade their config.

; Turn on the opt-in built-in rule: warn on a function with no type declaration.
(lint-severity missing-type-declaration warn)

; A project-specific rule with an autofix. {$X} interpolates the captured
; argument into the message; (fix $X) rewrites the match to just its argument.
(lint-rule no-debug
  (pattern (debug! $X))
  (message "leftover debug! call around {$X}")
  (severity warn)
  (fix $X))

; Regex constraints filter a capture by its source text. This one flags a
; definition head that starts with a capital letter.
(lint-rule capitalized-function-name
  (pattern (= ($Func $$$Args) $$$Body))
  (metavariable-regex $Func "^[A-Z]")
  (message "function {$Func} starts with a capital letter")
  (severity warn))

; Code-as-data suppression: silence symbol.possibleTypo anywhere inside a
; (legacy ...) call. The pattern is matched structurally, exactly like a lint
; rule, so the suppression is data — not a function that runs. Add codes after
; the pattern to narrow it, or leave them off to silence every code.
(suppress (legacy $$$) symbol.possibleTypo)
