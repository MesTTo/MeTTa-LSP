;;; metta-mode.el --- Major mode for MeTTa source files -*- lexical-binding: t; -*-

;; SPDX-FileCopyrightText: 2026 MesTTo
;; SPDX-License-Identifier: Apache-2.0
;; Version: 0.11.1
;; Package-Requires: ((emacs "29.1"))
;; Keywords: languages
;; URL: https://github.com/MesTTo/MeTTa-LSP

;;; Commentary:

;; `metta-mode' provides syntax parsing and static font-lock for MeTTa files.
;; It does not select or configure an LSP client.  Eglot and lsp-mode setup
;; examples live in docs-site/lsp/editors.md.

;;; Code:

(defgroup metta nil
  "Editing MeTTa source files."
  :group 'languages)

(defface metta-mode-bracket-face
  '((t :inherit font-lock-builtin-face))
  "Face for MeTTa brackets."
  :group 'metta)

(defconst metta-mode-syntax-table
  (let ((table (make-syntax-table)))
    (modify-syntax-entry ?\; "<" table)
    (modify-syntax-entry ?\n ">" table)
    (modify-syntax-entry ?\" "\"" table)
    (modify-syntax-entry ?\' "\"" table)
    (modify-syntax-entry ?\\ "\\" table)
    (modify-syntax-entry ?\( "()" table)
    (modify-syntax-entry ?\) ")(" table)
    (modify-syntax-entry ?\[ "(]" table)
    (modify-syntax-entry ?\] ")[" table)
    (modify-syntax-entry ?\{ "(}" table)
    (modify-syntax-entry ?\} "){" table)
    table)
  "Syntax table for `metta-mode'.")

(defconst metta-mode-font-lock-keywords
  '(("\\_<@[A-Za-z_][A-Za-z0-9_*-]*!?\\_>" . font-lock-preprocessor-face)
    ("\\_<\\$[A-Za-z_][A-Za-z0-9_?!*/<>=.-]*\\_>" . font-lock-variable-name-face)
    ("\\_<&[A-Za-z_][A-Za-z0-9_?!*/<>=.-]*\\_>" . font-lock-builtin-face)
    ("\\_<%[A-Za-z][A-Za-z0-9]*%\\_>" . font-lock-type-face)
    ("\\_<[A-Z][A-Za-z0-9_?!*/<>=.-]*\\_>" . font-lock-type-face)
    ("\\_<\\(?:->\\|==\\|~=\\|[:=!]\\)\\_>" . font-lock-keyword-face)
    ("\\_<[+-]?\\(?:[0-9]+\\.?[0-9]*\\|\\.[0-9]+\\)\\(?:[eE][+-]?[0-9]+\\)?\\_>"
     . font-lock-constant-face)
    ("[][(){}]" 0 'metta-mode-bracket-face))
  "Static font-lock rules for `metta-mode'.")

;;;###autoload
(define-derived-mode metta-mode prog-mode "MeTTa"
  "Major mode for editing MeTTa source files."
  :syntax-table metta-mode-syntax-table
  (setq-local comment-start ";")
  (setq-local comment-start-skip ";+[ \t]*")
  (setq-local comment-end "")
  (setq-local font-lock-defaults
              '(metta-mode-font-lock-keywords nil nil
                (("!#$%&*+,-./:<=>?@^_`|~" . "_")))))

;;;###autoload
(add-to-list 'auto-mode-alist '("\\.metta\\'" . metta-mode))

(provide 'metta-mode)

;;; metta-mode.el ends here
