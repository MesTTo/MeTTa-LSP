; -----------------------------------------------------------------------------
; 14 -- Editor surfaces beyond hover and rename
;
; This file is for the features that do not need their own runtime example.
; Open it in VS Code with the MeTTa TS LSP extension installed.
;
;   Document symbols       open Outline, or run "Go to Symbol in Editor"
;   Workspace symbols      search for Shape, perimeter, square, or classify
;   Type definition        run "Go to Type Definition" on `Shape`
;   Declaration            run "Go to Declaration" on `perimeter`
;   Implementation         run "Go to Implementations" on `Shape`
;   Document highlight     put the cursor on `perimeter`
;   Linked editing         edit one `$side` in the first rule and the others link
;   Selection ranges       repeatedly expand selection inside `case`
;   Folding                fold the multi-line `describe-shape` definition
;   Semantic colours       inspect if/case/switch/let/match/eval/quote/arithmetic
; -----------------------------------------------------------------------------

!(import! &self math)

(: Shape Type)
(: Square Shape)
(: Circle Shape)

; `Shape` is a type. Type Definition on Shape jumps to its declaration above.
(: perimeter (-> Shape Number Number))

; Declaration on `perimeter` jumps to the type declaration. Implementation on
; `Shape` lists the functions and constants whose signatures mention Shape.
(= (perimeter Square $side) (* 4 $side))
(= (perimeter Circle $r) (* 6 $r))

; Linked editing is variable-scoped. Put the cursor on `$side` below and start
; editing. Every `$side` in this rule changes together.
(= (scale-square $side)
   (+ $side (+ $side (+ $side $side))))

; A multi-line definition for folding and selection-range expansion. Put the
; cursor inside `(case ...)`, then run Expand Selection several times.
(= (describe-shape $shape $size)
   (case $shape
     ((Square (perimeter Square $size))
      (Circle (perimeter Circle $size))
      ($_ (empty)))))

; Semantic token buckets. The theme supplies the colours, but the server tags
; the roles: control flow, binding, patterns, modules, evaluation, quote forms,
; arithmetic, comparison, logic, effects, collections, predicates, and tests.
!(if (> 10 5) (perimeter Square 3) (empty))
!(switch Square ((Square ok) (Circle no)))
!(let $value (+ 1 2) (and (>= $value 3) True))
!(match &self (: $name Shape) $name)
!(eval (quote (perimeter Square 4)))
!(noeval (perimeter Circle 3))
!(add-atom &self (seen Square))
!(length (Square Circle))
!(is-var $shape)
!(assertEqual (perimeter Square 5) 20)

; Imported definitions also participate in links, hovers, references, and Run.
!(main 41)
