; ─────────────────────────────────────────────────────────────────────────────
; 02 — Running, tracing, and visualising
;
; Every runnable form has a "▶ Run" code lens and a "↝ Trace" code lens above
; it. The editor title bar has matching Run and Trace buttons. Results print to
; the "MeTTa Run" and "MeTTa Trace" output channels in MeTTa syntax. Running is
; UNGUARDED: there is no fuel or timeout cap from the editor — pragma! is the
; only limit mechanism.
;
; The visualise button (next to Run) opens the interactive MeTTaGrapher: step
; through the reduction, switch the graph and block views, and export a GIF. Put
; your cursor in a bang form and run "MeTTa: Visualise".
; ─────────────────────────────────────────────────────────────────────────────

;; The nth Fibonacci number. One clause guards the base case with `if`: in MeTTa
;; every matching clause fires, so a separate (= (fib 0) 0) would also match
;; (fib $n) and recurse into negatives — the `if` keeps it to a single path.
(: fib (-> Number Number))
(= (fib $n) (if (< $n 2) $n (+ (fib (- $n 1)) (fib (- $n 2)))))

; Click ▶ Run on this line — the output channel prints [55].
!(fib 10)

;; True when a number is even.
(= (even $n) (== 0 (% $n 2)))

; A nondeterministic search worth visualising: fan out six candidates, keep the
; even ones. Put your cursor here and run "MeTTa: Visualise" to step the branches.
!(let $x (superpose (1 2 3 4 5 6))
   (if (even $x) $x (empty)))

; A small knowledge base queried with match: add the facts to the space, then
; ask for Tom's grandchild through two parent hops.
!(add-atom &self (parent Tom Bob))
!(add-atom &self (parent Bob Ann))
!(match &self (parent Tom $p) (match &self (parent $p $gc) $gc))
