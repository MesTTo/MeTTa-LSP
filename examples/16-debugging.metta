; -----------------------------------------------------------------------------
; 16 -- Debug adapter
;
; Open the Run and Debug panel, choose "MeTTa: reduce query", and set:
;
;   program: ${workspaceFolder}/examples/16-debugging.metta
;   query:   (countdown 3)
;
; Step Over advances one rewrite at a time. Continue stops when the current
; expression contains `(breakpoint! ...)`, so the second query demonstrates the
; pause point.
;
; The CLI smoke for the same reduction path is:
;   metta-lsp trace examples/16-debugging.metta "(countdown 3)"
; -----------------------------------------------------------------------------

(: countdown (-> Number Number))
(= (countdown $n)
   (if (== $n 0) 0 (countdown (- $n 1))))

(: stop-at-two (-> Number Atom))
(= (stop-at-two $n)
   (if (== $n 2)
     (breakpoint! (stop-at-two $n))
     (if (== $n 0) done (stop-at-two (- $n 1)))))

!(countdown 3)
!(stop-at-two 4)
