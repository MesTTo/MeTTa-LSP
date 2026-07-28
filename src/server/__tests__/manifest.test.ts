// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Guard the package.json semantic-token contributions. A contributed semanticTokenType whose superType chain
// loops (most simply, superType === id) makes VS Code's getTypeHierarchy recurse without end while it styles
// a token, which hangs and crashes the editor window. The server emits standard VS Code types plus MeTTa
// refinements; every refinement must be contributed with a standard fallback.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SEMANTIC_TOKEN_TYPES } from "../analyzer.js";

interface TokenType {
  readonly id: string;
  readonly superType?: string;
}
interface CommandContribution {
  readonly command: string;
}
interface Manifest {
  readonly activationEvents?: readonly string[];
  readonly contributes?: {
    readonly commands?: readonly CommandContribution[];
    readonly menus?: {
      readonly commandPalette?: readonly CommandContribution[];
      readonly "editor/context"?: readonly CommandContribution[];
    };
    readonly semanticTokenTypes?: readonly TokenType[];
    readonly configuration?: {
      readonly properties?: Record<string, unknown>;
    };
  };
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as Manifest;
const tokenTypes = manifest.contributes?.semanticTokenTypes ?? [];
const contributedSettings = new Set(
  Object.keys(manifest.contributes?.configuration?.properties ?? {}).map((key) =>
    key.replace(/^metta\./, ""),
  ),
);

const STANDARD_TOKEN_TYPES = new Set([
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
  "label",
]);

describe("package.json semantic token type contributions", () => {
  it("declares no semantic token type whose superType is itself", () => {
    const selfReferential = tokenTypes
      .filter((type) => type.superType === type.id)
      .map((t) => t.id);
    expect(selfReferential).toEqual([]);
  });

  it("has no cycle in any superType chain", () => {
    const superOf = new Map(tokenTypes.map((type) => [type.id, type.superType]));
    for (const start of superOf.keys()) {
      const seen = new Set<string>();
      let current: string | undefined = start;
      while (current !== undefined) {
        expect(seen.has(current)).toBe(false);
        seen.add(current);
        current = superOf.get(current);
      }
    }
  });

  it("declares every custom server token with a standard fallback", () => {
    const byId = new Map(tokenTypes.map((type) => [type.id, type]));
    for (const token of SEMANTIC_TOKEN_TYPES) {
      if (STANDARD_TOKEN_TYPES.has(token)) continue;
      const contribution = byId.get(token);
      expect(contribution).toBeDefined();
      expect(STANDARD_TOKEN_TYPES.has(contribution?.superType ?? "")).toBe(true);
    }
  });
});

describe("package.json setting contributions", () => {
  it("declares every setting toggled by the VS Code quick-pick", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/client/extension.ts"), "utf8");
    const toggleKeys = [...source.matchAll(/\{\s*key:\s*"([^"]+)"/g)]
      .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
      .filter((key) => !key.startsWith("__"));
    expect(toggleKeys).not.toHaveLength(0);
    expect(toggleKeys.filter((key) => !contributedSettings.has(key))).toStrictEqual([]);
  });

  // A setting the server resolves but the manifest never declares still works when written by hand, and is
  // invisible in the settings UI, so nobody finds it. `metta.diagnostics.importResolution` sat that way.
  // DEFAULT_SETTINGS is the shape configResolve fills, so every leaf of it is a real setting.
  it("declares every setting the server resolves", () => {
    const resolvable: string[] = [];
    const walk = (value: Record<string, unknown>, prefix: readonly string[]): void => {
      for (const [key, child] of Object.entries(value)) {
        const keyPath = [...prefix, key];
        // An array setting (workspace.exclude) is a leaf, not a nested section.
        if (child !== null && typeof child === "object" && !Array.isArray(child))
          walk(child as Record<string, unknown>, keyPath);
        else resolvable.push(keyPath.join("."));
      }
    };
    walk(DEFAULT_SETTINGS as unknown as Record<string, unknown>, []);
    expect(resolvable).not.toHaveLength(0);
    expect(resolvable.filter((key) => !contributedSettings.has(key))).toStrictEqual([]);
  });
});

describe("package.json semantic refactoring contributions", () => {
  it("exposes the simplify command from activation through editor menus", () => {
    expect(manifest.activationEvents).toContain("onCommand:metta.simplify");
    expect(manifest.contributes?.commands?.map((entry) => entry.command)).toContain(
      "metta.simplify",
    );
    expect(manifest.contributes?.menus?.commandPalette?.map((entry) => entry.command)).toContain(
      "metta.simplify",
    );
    expect(
      manifest.contributes?.menus?.["editor/context"]?.map((entry) => entry.command),
    ).toContain("metta.simplify");
  });
});
