// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Config shape normalization across editors: a settings tree may be section-keyed (VS Code, Neovim,
// Sublime, Emacs) or the section's contents directly (Helix), and a null section means "use defaults".

import { describe, expect, it } from "vitest";
import { configurationToSettings, extractMettaSection } from "../configResolve.js";

describe("extractMettaSection", () => {
  it("unwraps a section-keyed tree", () => {
    expect(extractMettaSection({ metta: { docs: { baseUrl: "x" } } })).toStrictEqual({
      docs: { baseUrl: "x" },
    });
  });

  it("passes the section's contents through when not keyed", () => {
    expect(extractMettaSection({ docs: { baseUrl: "x" } })).toStrictEqual({
      docs: { baseUrl: "x" },
    });
  });

  it("treats a null section as defaults (empty override)", () => {
    expect(extractMettaSection({ metta: null })).toStrictEqual({});
  });

  it("returns an empty override for null, undefined, or non-object input", () => {
    expect(extractMettaSection(null)).toStrictEqual({});
    expect(extractMettaSection(undefined)).toStrictEqual({});
    expect(extractMettaSection("nonsense")).toStrictEqual({});
  });

  it("prefers the section key even when its value is empty", () => {
    // A section-keyed tree with an empty section overrides nothing, rather than being read as a direct
    // config that happens to have no known keys.
    expect(extractMettaSection({ metta: {}, unrelated: 1 })).toStrictEqual({});
  });
});

describe("configurationToSettings", () => {
  it("maps contributed settings into server settings", () => {
    expect(
      configurationToSettings({
        diagnostics: { semanticLint: true, prolog: false },
        completion: { includeSnippets: false },
        workspace: { maxFiles: 12, exclude: ["node_modules", "tmp"] },
        runtime: { guard: { timeoutMs: 123, experimental: { flatAtomspace: true } } },
        prolog: { executable: "scryer-prolog", timeoutMs: 10 },
      }),
    ).toMatchObject({
      diagnostics: { semanticLint: true, prolog: false },
      completion: { includeSnippets: false },
      workspace: { maxFiles: 12, exclude: ["node_modules", "tmp"] },
      runtime: { guard: { timeoutMs: 123, experimental: { flatAtomspace: true } } },
      prolog: { executable: "scryer-prolog", timeoutMs: 100 },
    });
  });
});
