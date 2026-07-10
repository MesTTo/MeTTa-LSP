;;; metta-mode-test.el --- Tests for metta-mode -*- lexical-binding: t; -*-

;; SPDX-FileCopyrightText: 2026 MesTTo
;; SPDX-License-Identifier: Apache-2.0

;;; Code:

(require 'ert)
(require 'metta-mode)

(defun metta-mode-test--face-at (source token &optional offset)
  "Return the face on TOKEN in fontified SOURCE at OFFSET within TOKEN."
  (with-temp-buffer
    (insert source)
    (metta-mode)
    (font-lock-ensure)
    (let ((start (string-match (regexp-quote token) source)))
      (should start)
      (get-text-property (+ 1 start (or offset 0)) 'face))))

(ert-deftest metta-mode-registers-metta-files ()
  (should (eq (cdr (assoc "\\.metta\\'" auto-mode-alist)) 'metta-mode)))

(ert-deftest metta-mode-parses-comments-and-strings ()
  (with-temp-buffer
    (insert "; comment\n\"double\" 'single' plain")
    (metta-mode)
    (should (nth 4 (syntax-ppss 4)))
    (should (nth 3 (syntax-ppss 13)))
    (should (nth 3 (syntax-ppss 22)))
    (should-not (nth 3 (syntax-ppss 30)))))

(ert-deftest metta-mode-fontifies-the-shared-lexical-model ()
  (let ((source "(@doc (= (typed $value &self %Undefined% Shape 42) 'x' \"text\"))"))
    (should (eq (metta-mode-test--face-at source "@doc") 'font-lock-preprocessor-face))
    (should (eq (metta-mode-test--face-at source "=") 'font-lock-keyword-face))
    (should (eq (metta-mode-test--face-at source "$value") 'font-lock-variable-name-face))
    (should (eq (metta-mode-test--face-at source "&self") 'font-lock-builtin-face))
    (should (eq (metta-mode-test--face-at source "%Undefined%") 'font-lock-type-face))
    (should (eq (metta-mode-test--face-at source "Shape") 'font-lock-type-face))
    (should (eq (metta-mode-test--face-at source "42") 'font-lock-constant-face))
    (should (eq (metta-mode-test--face-at source "'x'" 1) 'font-lock-string-face))
    (should (eq (metta-mode-test--face-at source "\"text\"" 1) 'font-lock-string-face))
    (should (eq (metta-mode-test--face-at source "(") 'metta-mode-bracket-face))))

(ert-deftest metta-mode-keeps-operators-and-numbers-atom-delimited ()
  (let ((source "import! foo=bar value42 lower"))
    (should-not (metta-mode-test--face-at source "!"))
    (should-not (metta-mode-test--face-at source "="))
    (should-not (metta-mode-test--face-at source "42"))
    (should-not (metta-mode-test--face-at source "lower"))))

(provide 'metta-mode-test)

;;; metta-mode-test.el ends here
