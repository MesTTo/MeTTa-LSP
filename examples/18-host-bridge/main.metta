; -----------------------------------------------------------------------------
; 18 -- TypeScript host bridge
;
; Open `examples/` as the VS Code workspace so examples/tsconfig.json is the
; TypeScript project. The LSP indexes host code in 18-host-bridge/host.ts.
;
; What to try:
;   Hover `my-max`          shows the TypeScript signature and doc comment.
;   F12 on `my-max`         jumps to the host function in host.ts.
;   Hover `Math.max`        inside js-atom resolves the ambient TypeScript lib.
;   `host-arg-type`         appears on the string literal in `(bad-host-call)`.
;   CLI: metta-lsp host-type examples/18-host-bridge/main.metta 15 21 --json
; -----------------------------------------------------------------------------

(= (winner $a $b) (my-max $a $b))

(= (bad-host-call) (my-max "x" 2))
; @suppress symbol.possibleTypo
(= (biggest-global) (js-atom "Math.max"))

!(winner 10 42)
!(bad-host-call)
