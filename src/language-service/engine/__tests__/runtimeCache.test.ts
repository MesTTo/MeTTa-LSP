// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The runtime cache reuses a definitive answer only while BOTH epochs still match, so a syntax edit and a
// space mutation invalidate it independently — the epoch-independence the two-epoch model rests on.

import { describe, expect, it } from "vitest";
import { RuntimeCache } from "../runtimeCache.js";

describe("RuntimeCache", () => {
  it("returns a stored answer at the epochs it was computed against", () => {
    const cache = new RuntimeCache<string>();
    const epochs = { syntaxEpoch: 3, atomspaceEpoch: 7 };
    expect(cache.get("getType", "(f 1)", epochs)).toBeUndefined();
    cache.set("getType", "(f 1)", epochs, "Number");
    expect(cache.get("getType", "(f 1)", epochs)).toBe("Number");
    expect(cache.size()).toBe(1);
  });

  it("misses once the syntax epoch has advanced (a text edit)", () => {
    const cache = new RuntimeCache<string>();
    cache.set("getType", "(f 1)", { syntaxEpoch: 3, atomspaceEpoch: 7 }, "Number");
    expect(cache.get("getType", "(f 1)", { syntaxEpoch: 4, atomspaceEpoch: 7 })).toBeUndefined();
  });

  it("misses once the atomspace epoch has advanced (a space mutation)", () => {
    const cache = new RuntimeCache<string>();
    cache.set("getType", "(f 1)", { syntaxEpoch: 3, atomspaceEpoch: 7 }, "Number");
    expect(cache.get("getType", "(f 1)", { syntaxEpoch: 3, atomspaceEpoch: 8 })).toBeUndefined();
  });

  it("keeps one entry per query, replacing it when the epochs move", () => {
    const cache = new RuntimeCache<string>();
    cache.set("getType", "(f 1)", { syntaxEpoch: 3, atomspaceEpoch: 7 }, "Number");
    cache.set("getType", "(f 1)", { syntaxEpoch: 5, atomspaceEpoch: 7 }, "Symbol");
    expect(cache.size()).toBe(1);
    expect(cache.get("getType", "(f 1)", { syntaxEpoch: 5, atomspaceEpoch: 7 })).toBe("Symbol");
  });
});
