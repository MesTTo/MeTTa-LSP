---
# SPDX-FileCopyrightText: 2026 MesTTo
# SPDX-License-Identifier: Apache-2.0
layout: page
title: Browser IDE
description: Edit, analyse, navigate, format, and run a multi-file MeTTa workspace in the browser.
outline: false
sidebar: false
---

<ClientOnly>
  <BrowserIDE />
</ClientOnly>

## Workspace storage

The IDE saves its workspace in this browser. It supports up to 24 `.metta` files, 131,072 characters per
file, and 524,288 characters across the workspace. Edits are flushed when the page becomes hidden or
closes. The status bar reports when browser storage is unavailable, so an unsaved workspace is not mistaken
for a persisted one.

## Running code

Run evaluates the active file in a stateless worker with source, fuel, stack, time, result, and output
limits. Imports resolve from the files in the browser workspace. Editing the workspace or switching files
cancels an active run and terminates its evaluation worker.

The browser runtime does not expose filesystem, Python, Prolog, or other Node host effects. Use the desktop
extension or CLI when a trusted program needs those host capabilities.
