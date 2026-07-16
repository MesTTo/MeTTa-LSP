; SPDX-FileCopyrightText: 2026 MesTTo
; SPDX-License-Identifier: Apache-2.0

; Agent-facing MeTTa-LSP skills for OmegaClaw.
;
; OmegaClaw skills are plain MeTTa equations advertised through getSkills. These
; wrappers call the MeTTa-LSP Python plugin loaded through config/plugins.yaml.

(= (metta-lsp-check $path) (py-call (metta_lsp.check $path)))
(= (metta-lsp-symbols $path) (py-call (metta_lsp.symbols $path)))
(= (metta-lsp-test $path) (py-call (metta_lsp.test $path)))
(= (metta-lsp-run $path) (py-call (metta_lsp.run $path)))
(= (metta-lsp-format-check $path) (py-call (metta_lsp.format_check $path)))

(= (metta-lsp-hover $path $line $character)
   (py-call (metta_lsp.hover $path $line $character)))
(= (metta-lsp-def $path $line $character)
   (py-call (metta_lsp.definition $path $line $character)))
(= (metta-lsp-refs $path $line $character)
   (py-call (metta_lsp.references $path $line $character)))
(= (metta-lsp-explain $path $line $character)
   (py-call (metta_lsp.explain $path $line $character)))

(= (metta-lsp-list-stdlib) (py-call (metta_lsp.list_stdlib)))
(= (metta-lsp-inspect $name) (py-call (metta_lsp.inspect $name)))

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
    "- Explain the form at a position as mixfix: metta-lsp-explain path line character"
    "- List the installed MeTTa standard library: metta-lsp-list-stdlib"
    "- Inspect a standard-library entry or module: metta-lsp-inspect name"))
