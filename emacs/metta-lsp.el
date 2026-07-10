;;; metta-lsp.el --- MeTTa major mode + LSP client setup -*- lexical-binding: t; -*-

;; Self-contained setup for editing MeTTa (.metta) files with the
;; MeTTa-LSP language server (https://github.com/MesTTo/MeTTa-LSP).
;;
;; It does two things Emacs cannot do on its own:
;;   1. Defines `metta-mode', a minimal major mode, so `.metta' files are
;;      recognized and get correct comment (`;') and bracket syntax. The
;;      upstream eglot/lsp-mode snippets reference `metta-mode' but never
;;      define it, so without this the server would never attach.
;;   2. Registers the stdio language server with eglot.
;;
;; Load it from your init file, e.g.:
;;   (load "/path/to/MeTTa-LSP/emacs/metta-lsp.el")
;;
;; Then open any .metta file. If you want the server to start automatically,
;; keep the `eglot-ensure' hook below (enabled by default). To start it
;; manually instead, comment that hook out and run M-x eglot in a .metta buffer.

;;; Code:

(require 'eglot)

;; --- Absolute path to the built language server -----------------------------
;; This must point at the compiled server produced by `build-lsp-server.sh'
;; (npm install && npm run compile). Update it if you move the repo.
(defvar metta-lsp-server-path
  "/path/to/MeTTa-LSP/dist/server/server.js"
  "Absolute path to dist/server/server.js in the MeTTa-LSP checkout.")

;; --- Syntax table -----------------------------------------------------------
;; Mirrors language-configuration.json: `;' line comments, "(" "[" "{" bracket
;; pairs, and double-quoted strings.
(defvar metta-mode-syntax-table
  (let ((table (make-syntax-table)))
    (modify-syntax-entry ?\; "<" table)   ; ; begins a line comment
    (modify-syntax-entry ?\n ">" table)   ; newline ends it
    (modify-syntax-entry ?\" "\"" table)  ; " delimits strings
    (modify-syntax-entry ?\( "()" table)
    (modify-syntax-entry ?\) ")(" table)
    (modify-syntax-entry ?\[ "(]" table)
    (modify-syntax-entry ?\] ")[" table)
    (modify-syntax-entry ?\{ "(}" table)
    (modify-syntax-entry ?\} "){" table)
    ;; Characters common in MeTTa symbols/operators, treated as symbol
    ;; constituents so runs like `->', `&self', `$x', `%Foo%' and `@doc' are a
    ;; single symbol. This lets the font-lock rules below anchor on \_< / \_>
    ;; symbol boundaries, matching the TextMate grammar's "standalone atom" rule
    ;; (so `import!' and `foo=bar' stay untouched, but a lone `!' or `=' colors).
    (dolist (ch '(?- ?! ?? ?* ?+ ?/ ?< ?> ?= ?& ?% ?$ ?_ ?~ ?: ?. ?@))
      (modify-syntax-entry ch "_" table))
    table)
  "Syntax table for `metta-mode'.")

;; --- Font-lock (static syntax highlighting) ---------------------------------
;; Ported from syntaxes/metta.tmLanguage.json. Comments and strings are colored
;; from the syntax table above; these rules add the rest. The server's semantic
;; tokens (meaning-based coloring) layer on top when the client supports them
;; (eglot on Emacs 30+); this is the fallback that always works.
(defconst metta-mode-font-lock-keywords
  (let ((atom-tail "[A-Za-z0-9_?!*/<>=.-]*"))
    `( ;; @doc / @param and other documentation atoms
      (,(concat "\\_<@[A-Za-z_][A-Za-z0-9_*-]*!?") . font-lock-preprocessor-face)
      ;; $variables
      (,(concat "\\_<\\$[A-Za-z_]" atom-tail) . font-lock-variable-name-face)
      ;; &self, &kb and other atomspace references
      (,(concat "\\_<&[A-Za-z_]" atom-tail) . font-lock-builtin-face)
      ;; %Undefined% and other grounded meta-types
      ("\\_<%[A-Za-z][A-Za-z0-9]*%\\_>" . font-lock-type-face)
      ;; Capitalized type/value atoms: Bool, Atom, True, False, ...
      (,(concat "\\_<[A-Z]" atom-tail "\\_>") . font-lock-type-face)
      ;; Core operators as standalone atoms: -> : = ! == ~=
      ("\\_<\\(?:->\\|==\\|~=\\|[:=!]\\)\\_>" . font-lock-keyword-face)
      ;; Numeric literals
      ("\\_<[+-]?\\(?:[0-9]+\\.?[0-9]*\\|\\.[0-9]+\\)\\(?:[eE][+-]?[0-9]+\\)?\\_>"
       . font-lock-constant-face)))
  "Font-lock rules for `metta-mode', ported from the TextMate grammar.")

;;;###autoload
(define-derived-mode metta-mode prog-mode "MeTTa"
  "Major mode for editing MeTTa source files."
  :syntax-table metta-mode-syntax-table
  (setq-local comment-start ";")
  (setq-local comment-start-skip ";+[ \t]*")
  (setq-local comment-end "")
  (setq-local font-lock-defaults '(metta-mode-font-lock-keywords))
  ;; MeTTa is fully parenthesized; reuse Lisp-style sexp navigation and indent.
  (setq-local indent-tabs-mode nil)
  (electric-pair-local-mode 1))

;;;###autoload
(add-to-list 'auto-mode-alist '("\\.metta\\'" . metta-mode))

;; --- eglot registration -----------------------------------------------------
(add-to-list 'eglot-server-programs
             `(metta-mode . ("node" ,metta-lsp-server-path "--stdio")))

;; Server settings, sent when eglot asks via workspace/configuration.
;; :json-false is Elisp's `false'; t is `true'. Adjust to taste.
(setq-default eglot-workspace-configuration
              '(:metta (:docs (:baseUrl "https://mestto.github.io/MeTTa-LSP/")
                        :inlayHints (:enabled t)
                        :pseudocode (:enabled :json-false)
                        :diagnostics (:semanticLint :json-false))))

;; Start the server automatically when a .metta file is opened.
;; Comment this out to start it manually with M-x eglot instead.
(add-hook 'metta-mode-hook #'eglot-ensure)

(provide 'metta-lsp)
;;; metta-lsp.el ends here
