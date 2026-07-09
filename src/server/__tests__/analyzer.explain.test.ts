// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The analyzer's explain surface renders the form at a position as mixfix notation, exposed as the `notation`
// field and inline in the human-readable `text`.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const MAIN = "file:///ws/main.metta";

function analyze(source: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/main.metta", source);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(MAIN, source, 1, true);
  return analyzer;
}

describe("analyzer explainForm — mixfix notation", () => {
  it("renders a rule definition as mixfix", () => {
    const explanation = analyze("(= (inc $x) (+ $x 1))").explainForm(MAIN, {
      line: 0,
      character: 1,
    });
    expect(explanation?.notation).toBe("inc($x) = $x + 1");
    expect(explanation?.text).toContain("Notation: inc($x) = $x + 1");
  });

  it("renders a type declaration with a curried arrow", () => {
    const explanation = analyze("(: inc (-> Number Number))").explainForm(MAIN, {
      line: 0,
      character: 1,
    });
    expect(explanation?.notation).toBe("inc : Number -> Number");
  });

  it("does not explain ordinary comment text", () => {
    const explanation = analyze("; a walkthrough comment\n(: inc (-> Number Number))").explainForm(
      MAIN,
      {
        line: 0,
        character: 3,
      },
    );
    expect(explanation).toBeNull();
  });
});
