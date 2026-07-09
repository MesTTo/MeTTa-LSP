---
# SPDX-FileCopyrightText: 2026 MesTTo
# SPDX-License-Identifier: Apache-2.0
layout: home

hero:
  name: MeTTa LSP
  text: A language server for MeTTa
  tagline: Hovers, diagnostics, formatting, run and trace commands, visualisation, generated reference pages, and an MCP tool for agents. The same language server core runs in VS Code, Neovim, Helix, Emacs, Sublime, browser hosts, and CLI workflows.
  image:
    src: /search.gif
    alt: MeTTaGrapher playing a generate-and-test search, where candidate selections fan out, are tested, and prune to the answers
  actions:
    - theme: brand
      text: The language server
      link: /lsp/overview
    - theme: alt
      text: Editor setup
      link: /lsp/editors
    - theme: alt
      text: Diagnostics
      link: /diagnostics/
    - theme: alt
      text: GitHub
      link: https://github.com/MesTTo/MeTTa-LSP

features:
  - title: Rust-analyzer-style hovers
    details: Signature, interpreter-exact type, definition site, and a link to the builtins reference. Diagnostics link to a catalogue page with the message and the fix.
  - title: Run and visualise
    details: Run a file unguarded from the ▶ button; visualise its reduction with the interactive MeTTaGrapher, step through it, and export a GIF.
  - title: Python interop
    details: py-atom, py-call, and py-eval evaluate against real CPython on an unguarded run. Guarded evaluation never loads the bridge, so py atoms stay inert there by construction.
  - title: Programmatic API
    details: 'import { lint, diagnostics, format, run } from "metta-ts-lsp/dsl". Call language-server features from tests, scripts, agents, and browser tools.'
  - title: An agent tool
    details: 'The MCP server gives coding agents MeTTa intelligence: definition, references, hover, symbols, and call hierarchy. One command registers it with Claude Code, Codex, or any MCP client.'
  - title: Every editor
    details: Reads configuration from initializationOptions, a workspace/configuration pull, or a didChangeConfiguration push, so VS Code, Neovim, Helix, Emacs, and Sublime all work.
---
