// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// End-to-end proof for the eDSL's plain-string surface: a real ts.LanguageService wrapped by
// decorateStringArgs answers MeTTa requests inside db.q("...") and the other string calls, repositioned into
// the .ts file, without touching ordinary TypeScript behavior elsewhere.

import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { decorateStringArgs } from "../decorateStringArgs.js";
import { MettaTemplateService } from "../mettaTemplateService.js";
import { inMemoryLanguageService } from "./tsHarness.js";

const FILE = "/query.ts";
const SOURCE = [
  'import { mettaDB } from "@metta-ts/edsl";',
  "const db = mettaDB();",
  'db.q("(car-atomm 1)");',
].join("\n");

function decorated(source = SOURCE): ts.LanguageService {
  const base = inMemoryLanguageService(FILE, source);
  return decorateStringArgs(ts, base, new MettaTemplateService(ts));
}

describe("embedded MeTTa in eDSL string arguments", () => {
  it('flags an undefined atom inside db.q("...") at its offset in the .ts file', () => {
    const metta = decorated()
      .getSemanticDiagnostics(FILE)
      .filter((diag) => diag.source === "metta");
    expect(metta.length).toBeGreaterThanOrEqual(1);
    expect(
      metta.some(
        (diag) => typeof diag.messageText === "string" && diag.messageText.includes("car-atomm"),
      ),
    ).toBe(true);
    expect(metta.some((diag) => diag.start === SOURCE.indexOf("car-atomm"))).toBe(true);
  });

  it("offers completions inside the string", () => {
    // just after the opening `(` of the query, where the prefix is empty
    const position = SOURCE.indexOf("(car-atomm") + 1;
    const names = (
      decorated().getCompletionsAtPosition(FILE, position, undefined)?.entries ?? []
    ).map((entry) => entry.name);
    expect(names).toContain("match");
  });

  it("leaves a file that does not import the eDSL untouched", () => {
    const plain = ["const db = makeThing();", 'db.q("(car-atomm 1)");'].join("\n");
    const metta = decorated(plain)
      .getSemanticDiagnostics(FILE)
      .filter((diag) => diag.source === "metta");
    expect(metta).toHaveLength(0);
  });
});
