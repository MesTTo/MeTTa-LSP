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
import { SEMANTIC_TOKEN_TYPES } from "../analyzer.js";

interface TokenType {
  readonly id: string;
  readonly superType?: string;
}
interface Manifest {
  readonly contributes?: {
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
});
