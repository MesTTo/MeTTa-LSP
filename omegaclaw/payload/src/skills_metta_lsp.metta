; SPDX-FileCopyrightText: 2026 MesTTo
; SPDX-License-Identifier: Apache-2.0

; Agent-facing MeTTa-LSP skills for OmegaClaw.
;
; OmegaClaw skills are plain MeTTa equations advertised through getSkills. These
; wrappers call the MeTTa-LSP CLI through the Python bridge installed beside this
; file, so an OmegaClaw agent can ask the same interpreter-backed language service
; for diagnostics, symbols, hovers, definitions, references, tests, and runs.
!(import! &self (library OmegaClaw-Core ./src/metta_lsp.py))

(= (metta-lsp-check $path) (py-call (metta_lsp.check $path)))
(= (metta-lsp-symbols $path) (py-call (metta_lsp.symbols $path)))
(= (metta-lsp-test $path) (py-call (metta_lsp.test $path)))
(= (metta-lsp-run $path) (py-call (metta_lsp.run $path)))
(= (metta-lsp-format-check $path) (py-call (metta_lsp.format_check $path)))

; Position specs are one OmegaClaw string: "path line character".
(= (metta-lsp-hover $spec) (py-call (metta_lsp.hover $spec)))
(= (metta-lsp-def $spec) (py-call (metta_lsp.definition $spec)))
(= (metta-lsp-refs $spec) (py-call (metta_lsp.references $spec)))
(= (metta-lsp-explain $spec) (py-call (metta_lsp.explain $spec)))

; Expert escape hatch. Not advertised in getSkills by default.
(= (metta-lsp-cli $args) (py-call (metta_lsp.cli $args)))

(= (metta-lsp-skills-doc)
   ("- Check a MeTTa file with MeTTa-LSP diagnostics and lint: metta-lsp-check path"
    "- List document symbols in a MeTTa file: metta-lsp-symbols path"
    "- Run assert tests in a MeTTa file: metta-lsp-test path"
    "- Evaluate bang queries in a MeTTa file: metta-lsp-run path"
    "- Check whether a MeTTa file is formatted: metta-lsp-format-check path"
    "- Show hover docs/types at a position: metta-lsp-hover path line character"
    "- Find the definition at a position: metta-lsp-def path line character"
    "- Find references at a position: metta-lsp-refs path line character"
    "- Explain the form at a position as mixfix: metta-lsp-explain path line character"))
