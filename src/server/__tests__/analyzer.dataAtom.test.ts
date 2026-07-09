// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// An unknown head is valid data in MeTTa: it reduces to itself (smart dispatch) and a definition may be added
// later, so it is never an "undefined" error — not the head of an add-atom fact, not a match pattern or
// template, not a nested constructor, and not even a head in evaluated position. Only a near-miss of a known
// name earns a hint. These check that the common data-atom shapes raise no symbol.* hint at all.

import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function symbolHints(text: string): (string | number | undefined)[] {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer
    .validate(URI)
    .map((d) => d.code)
    .filter((code) => String(code).startsWith("symbol."));
}

describe("data-atom heads raise no symbol hint", () => {
  it("does not flag the head of an atom added via add-atom", () => {
    expect(symbolHints("!(add-atom &self (parent Tom Bob))")).toEqual([]);
  });

  it("does not flag heads in a match pattern or template", () => {
    expect(symbolHints("!(match &self (parent Tom $p) (child $p))")).toEqual([]);
  });

  it("does not flag a head nested inside a data atom", () => {
    expect(symbolHints("!(add-atom &self (edge (node a) (node b)))")).toEqual([]);
  });

  it("does not flag an unknown head in evaluated position — it is valid data too", () => {
    // frobnicate is close to no known name, so there is no hint at all (not even a possible-typo).
    expect(symbolHints("(= (f $x) (frobnicate $x))")).toEqual([]);
  });
});
