// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Walk-up discovery of lint.metta: the nearest config wins, absence yields the empty config, and an
// unchanged file is parsed once (cached by mtime) then re-parsed after an edit.

import { describe, expect, it } from "vitest";
import { ConfigLoader } from "../configLoader.js";
import { InMemoryFileProvider } from "../fileProvider.js";

describe("ConfigLoader", () => {
  it("finds a lint.metta in the file's own directory", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(format-width 100)");
    files.writeFile("/ws/src/main.metta", "(a b)");
    const config = new ConfigLoader(files).loadForFile("/ws/src/main.metta");
    expect(config.format.width).toBe(100);
  });

  it("walks up to a parent directory to find the config", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(format-indent 4)");
    files.writeFile("/ws/a/b/c/deep.metta", "(a b)");
    const config = new ConfigLoader(files).loadForFile("/ws/a/b/c/deep.metta");
    expect(config.format.indent).toBe(4);
  });

  it("prefers the nearest config when several exist up the chain", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(format-width 80)");
    files.writeFile("/ws/pkg/lint.metta", "(format-width 120)");
    files.writeFile("/ws/pkg/main.metta", "(a b)");
    const config = new ConfigLoader(files).loadForFile("/ws/pkg/main.metta");
    expect(config.format.width).toBe(120);
  });

  it("returns the empty config when no lint.metta exists", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/main.metta", "(a b)");
    const config = new ConfigLoader(files).loadForFile("/ws/main.metta");
    expect(config.format.width).toBeUndefined();
    expect(config.format.blockForms).toEqual({});
    expect(config.issues).toEqual([]);
  });

  it("re-parses after the config file changes (mtime bump)", () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/lint.metta", "(format-width 80)");
    files.writeFile("/ws/main.metta", "(a b)");
    const loader = new ConfigLoader(files);
    expect(loader.loadForFile("/ws/main.metta").format.width).toBe(80);
    files.writeFile("/ws/lint.metta", "(format-width 200)");
    expect(loader.loadForFile("/ws/main.metta").format.width).toBe(200);
  });
});
