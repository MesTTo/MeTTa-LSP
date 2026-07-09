; ─────────────────────────────────────────────────────────────────────────────
; 03 — Python interop
;
; py-atom, py-call, py-eval, py-dot, and py-import evaluate against real CPython
; on an UNGUARDED run (the ▶ button or the run lens). Guarded evaluation — the
; agent-facing surface — never loads the Python bridge, so these atoms stay
; inert there by construction. You need python3 on your PATH.
;
; Hover any py-* symbol for its signature and an example.
; ─────────────────────────────────────────────────────────────────────────────

; py-eval runs a Python expression string.
!(py-eval "2 ** 10")

; py-atom lifts a Python callable, then you apply it like any function.
!((py-atom operator.add) 40 2)

; py-dot reaches an attribute off a live Python handle (from py-atom or
; py-import). Reach a value directly, or a method and then call it.
!(py-dot (py-atom math) pi)
!((py-dot (py-atom math) sqrt) 16)

; Compose them: import a module, then call into it by dotted path.
!(py-import math)
!((py-atom math.sqrt) 144)
