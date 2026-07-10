# Using MeTTa-LSP with Emacs

A repeatable guide for wiring the MeTTa language server into Emacs. Written for
eglot (built into Emacs 29+, no extra package). An lsp-mode alternative is at the
end.

## What you get

Open a `.metta` file and Emacs starts the MeTTa language server over stdio:
diagnostics, hover docs, completion, go-to-definition, inlay hints, and the other
capabilities the server advertises.

## Why two pieces are needed

Emacs has no built-in MeTTa support, so the setup supplies both:

1. **A major mode (`metta-mode`).** Emacs must know that `.metta` files are MeTTa
   and how their syntax works (`;` comments, `()[]{}` brackets, `"` strings)
   before any LSP client will attach. The upstream snippets mention `metta-mode`
   but never define it; `emacs/metta-lsp.el` in this repo defines it.
2. **A language-server registration.** Tells eglot to launch
   `node dist/server/server.js --stdio` for `metta-mode` buffers.

Both live in `emacs/metta-lsp.el`.

## Prerequisites

- **Node.js ≥ 20.19** on `PATH` (`node --version`). The server is a Node program.
- **Emacs 29 or newer** (for built-in eglot). Check with `M-x emacs-version`.
  On Emacs 28 or older, install eglot from GNU ELPA: `M-x package-install RET eglot RET`.
- **The server built.** From the repo root:

  ```sh
  bash build-lsp-server.sh
  ```

  That runs `npm install` and `npm run compile`, producing
  `dist/server/server.js`. Re-run it after pulling new changes to the repo.

## One-time setup

1. Confirm the server path. `emacs/metta-lsp.el` defines:

   ```elisp
   (defvar metta-lsp-server-path
     "/path/to/MeTTa-LSP/dist/server/server.js" ...)
   ```

   If your checkout lives elsewhere, edit that string.

2. Load the file from your Emacs init (`~/.emacs`, `~/.emacs.d/init.el`, or
   `~/.config/emacs/init.el`). Add:

   ```elisp
   (load "/path/to/MeTTa-LSP/emacs/metta-lsp.el")
   ```

3. Restart Emacs (or evaluate the `load` line with `C-x C-e` at its end).

4. Open any `.metta` file — for example `examples/` in this repo. The mode line
   should read `MeTTa`, and eglot starts the server automatically. Confirm with
   `M-x eglot-events-buffer` or watch the echo area for
   `[eglot] Connected!`.

## Everyday commands

- `M-x eglot` — start the server manually in the current buffer (only needed if
  you disable the auto-start hook).
- `M-x eglot-shutdown` — stop it.
- `M-x eglot-reconnect` — restart after rebuilding the server.
- `M-.` / `M-,` — jump to definition / back.
- `C-h .` (`display-local-help`) or `eldoc` — hover documentation.
- `M-x eglot-rename`, `M-x eglot-code-actions`, `M-x eglot-format`.
- Completion works through `completion-at-point` (`C-M-i`), or your usual
  completion UI (corfu/company) if configured.

## Server settings

The server reads settings under the `metta` section. In `metta-lsp.el` they are
set via `eglot-workspace-configuration`:

```elisp
(setq-default eglot-workspace-configuration
              '(:metta (:docs (:baseUrl "https://mestto.github.io/MeTTa-LSP/")
                        :inlayHints (:enabled t)
                        :pseudocode (:enabled :json-false)
                        :diagnostics (:semanticLint :json-false))))
```

Elisp plist rules: keys are `:keyword`, nesting uses nested plists, `t` means
JSON `true`, and `:json-false` means JSON `false`. Other keys the server accepts
include `:workspace (:maxFiles 4000)`. After changing this, run
`M-x eglot-reconnect`.

## Repeating this on another machine

1. Clone the repo: `git clone https://github.com/MesTTo/MeTTa-LSP`.
2. Install Node.js ≥ 20.19 and Emacs ≥ 29.
3. From the repo root: `bash build-lsp-server.sh`.
4. In `emacs/metta-lsp.el`, set `metta-lsp-server-path` to that machine's
   absolute path to `dist/server/server.js`.
5. Add `(load ".../emacs/metta-lsp.el")` to that machine's Emacs init.
6. Restart Emacs and open a `.metta` file.

Tip: to avoid editing the path per machine, you can keep `metta-lsp.el` in your
Emacs config and compute the path from an environment variable instead, e.g.
`(defvar metta-lsp-server-path (expand-file-name "MeTTa-LSP/dist/server/server.js"
(getenv "REPOS")))`.

## Troubleshooting

- **`[eglot] (warning) Server tried to register unsupported capability
  workspace/didChangeConfiguration`.** Harmless. The server dynamically
  registers a config-change notification that eglot declines (eglot pulls config
  instead). Everything still works. To hide the pop-up entirely, add
  `(add-to-list 'warning-suppress-types '(eglot))` to your init — but that
  silences all eglot warnings, so leaving it visible is usually better.
- **Code has no colors.** `metta-lsp.el` provides static highlighting via
  font-lock (ported from the project's TextMate grammar), so comments, strings,
  `$variables`, `&refs`, `%Types%`, capitalized atoms, operators, and numbers
  color even without the server. If you edited `metta-lsp.el`, reload it
  (re-evaluate the `load` line or restart Emacs) and reopen the buffer, or run
  `M-x font-lock-update` in the buffer. Meaning-based coloring (definition vs
  call, known keyword) comes from the server's semantic tokens and requires
  eglot on **Emacs 30+**; on Emacs 29 you get the static font-lock colors only.
- **Nothing happens on opening a `.metta` file.** Check the mode line says
  `MeTTa`. If not, `auto-mode-alist` was not set — confirm the `load` ran without
  error (`M-x view-echo-area-messages`).
- **`[eglot] Server programs error` / process exits immediately.** Run the exact
  command in a shell to see the real error:

  ```sh
  node /path/to/MeTTa-LSP/dist/server/server.js --stdio
  ```

  It should sit waiting for LSP input (Ctrl-C to quit). "Cannot find module"
  means `dist/` is missing or stale — re-run `bash build-lsp-server.sh`.
- **`node: command not found` inside Emacs.** Emacs may not inherit your shell
  `PATH`. Either use an absolute path to `node` in `metta-lsp.el` (replace
  `"node"` in the `eglot-server-programs` entry), or install the
  `exec-path-from-shell` package and call `(exec-path-from-shell-initialize)`.
- **See the traffic.** `M-x eglot-events-buffer` shows the JSON-RPC messages
  between Emacs and the server.

## Alternative: lsp-mode instead of eglot

If you already use lsp-mode, keep the `metta-mode` definition and syntax table
from `metta-lsp.el` (delete the eglot-specific lines) and register the server
like this:

```elisp
(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection
                     (list "node"
                           "/path/to/MeTTa-LSP/dist/server/server.js"
                           "--stdio"))
    :major-modes '(metta-mode)
    :server-id 'metta-ts-lsp)))
(add-hook 'metta-mode-hook #'lsp-deferred)
```

Set `metta.*` settings via `M-x customize` or `lsp-register-custom-settings`
under the `metta` section.
