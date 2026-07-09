// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// End-to-end proof that MeTTa intelligence reaches a real TypeScript language server. A genuine
// ts.LanguageService is built over an in-memory .ts file, the decorator (the same one the shipped plugin
// uses) wraps it with our MettaTemplateService, and the whole path runs: the decorator discovers the `m`
// tagged template, substitutes its `${}` holes, calls our service on the body, and repositions our diagnostic
// back into the .ts file. The only shim is `project`, whose two methods do the line/offset math a real
// tsserver ScriptInfo would, computed from the source file with ts's own helpers.

import * as ts from "typescript";
import { decorateWithTemplateLanguageService } from "typescript-template-language-service-decorator";
import { describe, expect, it } from "vitest";
import { MettaTemplateService } from "../mettaTemplateService.js";
import { inMemoryLanguageService, stubProject } from "./tsHarness.js";

const FILE = "/embedded.ts";
const SOURCE = [
  "declare function m(strings: TemplateStringsArray, ...values: unknown[]): unknown;",
  "const program = m`(= (foo $x) (car-atomm $x))`;",
].join("\n");

function decoratedService(): ts.LanguageService {
  const base = inMemoryLanguageService(FILE, SOURCE);
  return decorateWithTemplateLanguageService(
    ts,
    base,
    stubProject(base, FILE),
    new MettaTemplateService(ts),
    {
      tags: ["m", "mAll"],
      enableForStringWithSubstitutions: true,
      getSubstitution: (_template, start, end) => `$${"x".repeat(Math.max(0, end - start - 1))}`,
    },
  );
}

describe("embedded MeTTa in a real TypeScript language service", () => {
  it("surfaces the undefined-atom diagnostic repositioned into the .ts file", () => {
    const diagnostics = decoratedService().getSemanticDiagnostics(FILE);
    const metta = diagnostics.filter(
      (diag) => diag.source === "metta" && typeof diag.messageText === "string",
    );
    expect(metta.length).toBeGreaterThanOrEqual(1);
    // the diagnostic message names the offending atom
    expect(
      metta.some(
        (diag) => typeof diag.messageText === "string" && diag.messageText.includes("car-atomm"),
      ),
    ).toBe(true);
    // and its start is repositioned to where `car-atomm` actually sits in the whole .ts source
    const expectedStart = SOURCE.indexOf("car-atomm");
    expect(metta.some((diag) => diag.start === expectedStart)).toBe(true);
  });

  it("does not flag the interpolation placeholder or the well-formed head", () => {
    // `foo` is defined by the very rule it heads, so the only MeTTa complaint is the unknown atom; the
    // `${x}` substitution is inert (it reads as a variable), so it is never reported.
    const metta = decoratedService()
      .getSemanticDiagnostics(FILE)
      .filter((diag) => diag.source === "metta");
    expect(metta).toHaveLength(1);
    expect(metta[0]?.length).toBe("car-atomm".length);
    expect(metta[0]?.messageText).toContain("car-atomm");
    expect(
      metta.some((diag) => typeof diag.messageText === "string" && diag.messageText.includes("$x")),
    ).toBe(false);
  });
});
