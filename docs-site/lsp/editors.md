# Editor setup

The language server is a single stdio process, `node dist/server/server.js --stdio`. Every editor gets the
same features; only the way you launch it and pass settings differs. Settings live under the `metta`
section (e.g. `metta.docs.baseUrl`, `metta.inlayHints.enabled`, `metta.pseudocode.enabled`).

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

The server reads configuration from whichever mechanism your editor uses, so it is IDE-agnostic:

- it **pulls** config via `workspace/configuration` when the client advertises it (VS Code, Emacs
  lsp-mode and eglot);
- it accepts a **push** through `workspace/didChangeConfiguration` for clients that send settings that way
  (Neovim, Sublime);
- and it reads **`initializationOptions`** at startup for clients that only pass config there (Helix).

## VS Code

Install the extension. Settings live in `settings.json` under `metta.*`, or use the status-bar button /
**MeTTa: Settings** quick-pick.

## Neovim (0.11+)

```lua
vim.lsp.config('metta_ts_lsp', {
  cmd = { 'node', '/path/to/metta-ts-lsp/dist/server/server.js', '--stdio' },
  filetypes = { 'metta' },
  root_markers = { 'lint.metta', '.git' },
  settings = {
    metta = {
      docs = { baseUrl = 'https://your-user.github.io/MeTTa-LSP' },
      inlayHints = { enabled = true },
      pseudocode = { enabled = false },
    },
  },
})
vim.lsp.enable('metta_ts_lsp')
```

## Helix (`languages.toml`)

```toml
[language-server.metta-ts-lsp]
command = "node"
args = ["/path/to/metta-ts-lsp/dist/server/server.js", "--stdio"]

[language-server.metta-ts-lsp.config.metta]
docs = { baseUrl = "https://your-user.github.io/MeTTa-LSP" }
inlayHints = { enabled = true }
pseudocode = { enabled = false }

[[language]]
name = "metta"
scope = "source.metta"
file-types = ["metta"]
language-servers = ["metta-ts-lsp"]
```

## Emacs

Emacs does not ship a MeTTa major mode. Load the repository's editor-neutral mode first. It associates
`.metta` files with `metta-mode` and provides comments, strings, brackets, and static font-lock whether or not
an LSP client is active:

```elisp
(load "/path/to/metta-ts-lsp/emacs/metta-mode.el")
```

Terminal Emacs supports the same LSP operations as the GUI. Eglot presents hover documentation through
ElDoc in the echo area; `M-x eldoc-doc-buffer` opens the full result in a buffer.

### Eglot

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
    '(metta-mode . ("node" "/path/to/metta-ts-lsp/dist/server/server.js" "--stdio"))))

(defun metta-eglot-setup ()
  (setq-local eglot-workspace-configuration
    '(:metta (:docs (:baseUrl "https://your-user.github.io/MeTTa-LSP")
              :inlayHints (:enabled t)
              :pseudocode (:enabled :json-false))))
  (eglot-ensure))

(add-hook 'metta-mode-hook #'metta-eglot-setup)
```

### lsp-mode

```elisp
(with-eval-after-load 'lsp-mode
  (add-to-list 'lsp-language-id-configuration '(metta-mode . "metta"))
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection
                     '("node" "/path/to/metta-ts-lsp/dist/server/server.js" "--stdio"))
    :major-modes '(metta-mode)
    :server-id 'metta-ts-lsp)))
(add-hook 'metta-mode-hook #'lsp-deferred)
;; Set metta.* via customize or lsp-register-custom-settings under the "metta" section.
```

## Sublime Text (LSP package)

```json
{
  "clients": {
    "metta-ts-lsp": {
      "enabled": true,
      "command": ["node", "/path/to/metta-ts-lsp/dist/server/server.js", "--stdio"],
      "selector": "source.metta",
      "settings": {
        "metta.docs.baseUrl": "https://your-user.github.io/MeTTa-LSP",
        "metta.inlayHints.enabled": true
      }
    }
  }
}
```
