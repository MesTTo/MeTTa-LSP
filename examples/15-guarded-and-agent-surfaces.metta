; -----------------------------------------------------------------------------
; 15 -- Guarded evaluation, commands, CLI, and MCP
;
; This file stays inside core MeTTa so guarded evaluation can run it safely.
; Select any expression, then run "MeTTa: Evaluate (Guarded Runtime)". The result
; goes to the "MeTTa Language Server" output channel with fuel, timeout, result,
; and source-hash metadata.
;
; Other extension commands to try from this file:
;   MeTTa: Run Static Checks
;   MeTTa: Show Index Stats
;   MeTTa: Show Side-Effect Policy
;   MeTTa: Settings
;   MeTTa: Restart Language Server
;
; The same analyzer is exposed to terminals and agents:
;   metta-lsp capabilities
;   metta-lsp check examples/15-guarded-and-agent-surfaces.metta --json
;   metta-lsp hover examples/15-guarded-and-agent-surfaces.metta 24 5
;   metta-lsp run examples/15-guarded-and-agent-surfaces.metta
;   node dist/mcp/server.js --workspace examples < examples/mcp-smoke.jsonl
; -----------------------------------------------------------------------------

(: double (-> Number Number))
(= (double $x) (* $x 2))

(: guarded-sum (-> Number Number))
(= (guarded-sum $n)
   (if (== $n 0) 0 (+ $n (guarded-sum (- $n 1)))))

; Hover previews are guarded too. Hover `double` or `guarded-sum` here.
!(double 21)
!(guarded-sum 5)

; Agent tools can target the same positions. For example, the MCP lsp_hover tool
; can ask for line 27, character 5 in this file and receives the same hover data.
(= (agent-visible $x) (double $x))
!(agent-visible 9)
