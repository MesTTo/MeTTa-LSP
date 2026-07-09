; ─────────────────────────────────────────────────────────────────────────────
; 13 — Reduction trace
;
;   Watch a query reduce step by step, with the bindings at each rewrite:
;     metta-lsp trace <file> "<query>"
;   In the editor click ↝ Trace for text output, or MeTTa: Visualise for the graph.
; ─────────────────────────────────────────────────────────────────────────────

;; Sum the numbers from 1 to n, guarding the recursion with if so it stops at 0.
;; (Two rules — a (sum-to 0) base case and a recursive one — would both match 0,
;; so the recursion runs away; the guard keeps it single-valued.)
(: sum-to (-> Number Number))
(= (sum-to $n) (if (== $n 0) 0 (+ $n (sum-to (- $n 1)))))

; Trace how (sum-to 3) reduces:
;   metta-lsp trace examples/13-trace.metta "(sum-to 3)"
;   or click the ↝ Trace code lens above the query below.
; Each step is one rewrite — (sum-to 3) → (+ 3 (sum-to 2)) → … → 6 — so you can
; see which rule fired and what $n was bound to along the way. Run it for the
; answer:
!(sum-to 3)
