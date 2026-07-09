; ─────────────────────────────────────────────────────────────────────────────
; 10 — Testing
;
;   assertEqual            run a call, compare its result to an expected value
;   assertEqualToResult    compare against an explicit result set, unevaluated
;   Test Explorer          each top-level (assert…) is a test in the sidebar
;   Run tests              metta-lsp test <file>   (or the Test Explorer's ▶)
; ─────────────────────────────────────────────────────────────────────────────

;; The function under test.
(: double (-> Number Number))
(= (double $x) (* $x 2))

; A passing test: double 21 is 42. In the editor this gets a green tick in the
; gutter and an entry in the Test Explorer.
!(assertEqual (double 21) 42)

; assertEqualToResult compares against an explicit result set without evaluating
; the right side, so you can assert the exact atoms a query returns.
!(assertEqualToResult (double 5) (10))

; A deliberately failing test, so you can see a failure reported. double 3 is 6,
; not 7: the Test Explorer marks it red and the runner prints the interpreter's
; own (Error … results-are-not-equal).
!(assertEqual (double 3) 7)

; From the terminal:
;   metta-lsp test examples/10-testing.metta            PASS/FAIL summary
;   metta-lsp test examples/10-testing.metta --tap      TAP, for a TAP consumer
;   metta-lsp test examples/10-testing.metta --junit    JUnit XML, for CI
