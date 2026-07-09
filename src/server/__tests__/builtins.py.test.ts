// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The Python interop family in the language layer: every public head from @metta-ts/py is a known builtin,
// so hover documents it, completion offers it, and the undefined-function diagnostic stays quiet on py-using
// programs even though @metta-ts/core itself has no such ops.

import { MockPyBridge, PY_METTA_SRC, pyCoreAsyncOps } from "@metta-ts/py";
import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { PY_OP_NAMES } from "../builtins.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { expectBuiltinFamilyRegistered, expectNameSetExact } from "./builtinFamilyAssertions.js";

const PY_HELPERS = ["py-eval", "py-str"];
const FAMILY = [
  "py-atom",
  "py-call",
  "py-import",
  "py-dot",
  "py-list",
  "py-tuple",
  "py-dict",
  "py-chain",
  ...PY_HELPERS,
];

describe("py builtins", () => {
  it("tracks the public @metta-ts/py bridge surface", () => {
    const grounded = [...pyCoreAsyncOps(new MockPyBridge()).keys()].sort();
    expect(grounded).toStrictEqual(
      [
        "py-atom",
        "py-call",
        "py-chain",
        "py-dict",
        "py-dot",
        "py-import",
        "py-list",
        "py-tuple",
      ].sort(),
    );
    for (const helper of PY_HELPERS) expect(PY_METTA_SRC).toContain(`(= (${helper}`);
  });

  it("registers the whole family with signatures and docs", () => {
    expect.assertions(FAMILY.length * 4);
    expectBuiltinFamilyRegistered(FAMILY);
  });

  it("PY_OP_NAMES is exactly the py- family", () => {
    expect.hasAssertions();
    expectNameSetExact(PY_OP_NAMES, FAMILY);
  });

  it("raises no symbol hint on a py-using program — the py builtins are known", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/py.metta";
    const src = '!(py-import numpy)\n!(py-eval "2 ** 10")\n!((py-atom operator.add) 40 2)';
    files.writeFile("/ws/py.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    // py-import/py-eval/py-atom are catalogued builtins, so they are known heads: no possible-typo,
    // needs-import, or any other symbol.* hint fires on them.
    const symbolHints = analyzer
      .validate(uri)
      .filter((diagnostic) => String(diagnostic.code).startsWith("symbol."));
    expect(symbolHints).toStrictEqual([]);
  });
});
