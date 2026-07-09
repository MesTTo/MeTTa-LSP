// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The pure CST classifier that recognises a host reference embedded in a MeTTa string argument:
// `(js-atom "Dotted.path")` names a JS global to resolve, `(js-dot <obj> "prop")` names a member. Only a
// position on that string argument classifies; the head symbol and unrelated strings do not.

import { describe, expect, it } from "vitest";
import type { Position } from "vscode-languageserver-types";
import { parseMeTTa } from "../../parser.js";
import { classifyGroundedSite } from "../groundedSite.js";

function siteAt(src: string, position: Position) {
  return classifyGroundedSite(parseMeTTa("file:///t.metta", src, 1).root, position);
}

describe("classifyGroundedSite", () => {
  it("classifies a js-atom string as a global-probe site", () => {
    // the string spans characters 9..19: (js-atom |"Math.max"|)
    expect(siteAt('(js-atom "Math.max")', { line: 0, character: 12 })).toEqual({
      kind: "js-atom",
      path: "Math.max",
      range: { start: { line: 0, character: 9 }, end: { line: 0, character: 19 } },
    });
  });

  it("classifies the property string of a js-dot member access", () => {
    expect(siteAt('(js-dot obj "round")', { line: 0, character: 14 })).toMatchObject({
      kind: "js-dot",
      property: "round",
      receiver: { text: "obj" },
    });
  });

  it("returns null for a string that is not a host-interop argument", () => {
    expect(siteAt('(foo "bar")', { line: 0, character: 7 })).toBeNull();
  });

  it("returns null when the cursor is on the head symbol, not the string", () => {
    expect(siteAt('(js-atom "Math.max")', { line: 0, character: 3 })).toBeNull();
  });

  it("returns null for js-atom when the string is not the first argument", () => {
    // A malformed call where the string sits in the receiver slot must not resolve as a global path.
    expect(siteAt('(js-atom sym "Math.max")', { line: 0, character: 16 })).toBeNull();
  });

  it("resolves a js-atom nested inside another form", () => {
    expect(siteAt('(= (f) (js-atom "Number.isFinite"))', { line: 0, character: 20 })).toMatchObject(
      { kind: "js-atom", path: "Number.isFinite" },
    );
  });
});
