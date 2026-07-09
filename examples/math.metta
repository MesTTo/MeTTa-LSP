; Example MeTTa file for the TypeScript LSP smoke tests.
(: inc (-> Number Number))
(= (inc $x)
  (+ $x 1))

(: double (-> Number Number))
(= (double $x)
  (+ $x $x))

(: main (-> Number Number))
(= (main $n)
  (double (inc $n)))

!(main 41)
