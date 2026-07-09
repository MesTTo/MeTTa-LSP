# MeTTa LSP docs site

The documentation site for the MeTTa language server, built with [VitePress](https://vitepress.dev). It is
the browser-previewable version of the editor and agent docs: the [MeTTa API reference](reference/metta/),
the [builtins reference](reference/builtins.md), the [diagnostics catalogue](diagnostics/), lint rules,
mixfix pseudocode, editor setup, MCP setup, and the LSP playground.

## Develop and build

```bash
npm install
npm run docs:dev      # local preview
npm run docs:build    # static site into .vitepress/dist
```

The language-server CLI gives the same workflow from the repo root:

```bash
metta-lsp doc                 # regenerate the MeTTa API reference
metta-lsp doc --open          # regenerate and open a local preview
metta-lsp doc --build         # regenerate and build the static site
metta-lsp doc --build --base /your-repo/
```

## Deploy and wire the editor

Deploy `.vitepress/dist` to any static host. For GitHub Pages project sites, build with the repository name
as the base:

```bash
VITEPRESS_BASE=/your-repo/ npm run docs:build
```

The default base is `/MeTTa-LSP/`. For local preview through the CLI, `metta-lsp doc --open` uses `/` so
the page opens at `http://127.0.0.1:<port>/reference/metta/`.

Then point the extension at the deployed site so hover "Open docs" links and diagnostic codes resolve here:
set `metta.docs.baseUrl` to the deployed origin plus the base, for example
`https://your-user.github.io/MeTTa-LSP`. The reference pages generate their heading anchors to match
`src/server/docsLinks.ts`, so a hover on `py-atom` lands on `/reference/builtins#py-atom` and the
`import.notRun` diagnostic links to `/diagnostics/import.notRun`.

## Regenerating the reference

`reference/metta/*`, `reference/builtins.md`, and `diagnostics/*.md` are generated from the language
server's own registry, analyzer, interpreter docs, TypeScript host bridge, and diagnostic codes, so they stay
in lockstep with the code. Regenerate them from `LSP/` after changing examples, builtins, host bridge
metadata, or the documented diagnostic set.
