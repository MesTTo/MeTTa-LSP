// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The builtins reference page is generated, not hand-maintained. These tests hold the two invariants that
// keeps true: every builtin is anchored to the same slug the hover's "Open docs" link jumps to, and the
// committed page is byte-identical to a fresh render from the catalog and get-doc (so it can never drift).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MettaDoc } from "../../language-service/coreRuntime.js";
import { CoreRuntime } from "../../language-service/coreRuntime.js";
import { allBuiltinDefinitions } from "../../server/builtins.js";
import { anchor } from "../../server/docsLinks.js";
import { type BuiltinEntry, renderBuiltinReference } from "../builtinReference.js";

const PAGE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs-site/reference/builtins.md",
);

// The entries the generator feeds the renderer: every builtin, enriched by get-doc where the symbol
// self-documents (none of core's builtins do today, so this is catalog-driven — but the merge path is live).
function generatedEntries(): BuiltinEntry[] {
  const runtime = new CoreRuntime();
  return allBuiltinDefinitions().map((def) => {
    const result = runtime.getDoc("", def.name);
    return { def, doc: result.isErr() ? null : result.value };
  });
}

describe("builtins reference generation", () => {
  it("anchors every builtin to the slug the hover docs link uses", () => {
    const defs = allBuiltinDefinitions();
    const page = renderBuiltinReference(defs.map((def) => ({ def, doc: null })));
    for (const def of defs) {
      const slug = anchor(def.name);
      expect(page).toContain(`### \`${def.name}\` {#${slug}}`);
    }
  });

  it("keeps synthetic names with colliding readable slugs distinct", () => {
    const source = allBuiltinDefinitions()[0];
    if (source === undefined) throw new Error("builtin catalog is empty");
    const entries = ["a b", "a-b", "A-b"].map((name) => ({
      def: { ...source, name },
      doc: null,
    }));
    const page = renderBuiltinReference(entries);
    for (const { def } of entries) {
      expect(page).toContain(`### \`${def.name}\` {#${anchor(def.name)}}`);
    }
    const ids = [...page.matchAll(/\{#([^}]+)\}/g)].map((match) => match[1]);
    expect(new Set(ids)).toHaveLength(entries.length);
  });

  it("renders unique explicit heading ids for the docs site", () => {
    const defs = allBuiltinDefinitions();
    const page = renderBuiltinReference(defs.map((def) => ({ def, doc: null })));
    const ids = [...page.matchAll(/\{#([^}]+)\}/g)].map((match) => match[1]);
    const collisions = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    expect(collisions).toStrictEqual([]);
  });

  it("covers every builtin the catalog knows, under its kind's section", () => {
    const defs = allBuiltinDefinitions();
    const page = renderBuiltinReference(defs.map((def) => ({ def, doc: null })));
    expect((page.match(/^### /gm) ?? []).length).toBe(defs.length);
    expect(page).toContain("## Special forms and macros");
    expect(page).toContain("## Type constructors");
    expect(page).toContain("## Functions and operators");
  });

  it("renders a self-documenting symbol's parameters and return from get-doc", () => {
    const def = allBuiltinDefinitions().find((entry) => entry.name === "car-atom");
    if (def === undefined) throw new Error("car-atom missing from the catalog");
    const doc: MettaDoc = {
      item: "car-atom",
      kind: "function",
      type: "(-> Expression Atom)",
      description: "A hand-authored description.",
      params: [{ type: "Expression", description: "the list" }],
      return: { type: "Atom", description: "the head" },
    };
    const page = renderBuiltinReference([{ def, doc }]);
    // The @doc description wins over the catalog blurb, and the structured sections appear.
    expect(page).toContain("A hand-authored description.");
    expect(page).toContain("**Parameters**");
    expect(page).toContain("- `Expression` — the list");
    expect(page).toContain("**Returns** `Atom` — the head");
  });

  it("keeps the committed page byte-identical to a fresh render (no drift)", () => {
    const fresh = renderBuiltinReference(generatedEntries());
    const committed = readFileSync(PAGE_PATH, "utf8");
    expect(fresh).toBe(committed);
  });
});
