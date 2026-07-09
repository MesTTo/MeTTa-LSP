// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The interner mints one stable id per canonical file, collapses equivalent URI spellings, and round-trips
// id -> canonical URI; the URI helpers are the single normalization point those guarantees rest on.

import { describe, expect, it } from "vitest";
import { FileRegistry } from "../fileId.js";
import { isMettaFile, normalizeUri, pathToUri, uriToPath } from "../uri.js";

describe("FileRegistry", () => {
  it("mints one stable id per file and reuses it", () => {
    const registry = new FileRegistry();
    const a1 = registry.idFor("file:///ws/a.metta");
    const a2 = registry.idFor("file:///ws/a.metta");
    const b = registry.idFor("file:///ws/b.metta");
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(registry.size()).toBe(2);
  });

  it("collapses equivalent spellings of the same file to one id", () => {
    const registry = new FileRegistry();
    const direct = registry.idFor("file:///ws/a.metta");
    const viaPath = registry.idFor(pathToUri("/ws/a.metta"));
    expect(viaPath).toBe(direct);
    expect(registry.size()).toBe(1);
  });

  it("round-trips an id back to its canonical uri", () => {
    const registry = new FileRegistry();
    const id = registry.idFor("file:///ws/a.metta");
    expect(registry.uriFor(id)).toBe(normalizeUri("file:///ws/a.metta"));
  });

  it("peek reports a known file without minting, and undefined for an unknown one", () => {
    const registry = new FileRegistry();
    expect(registry.peek("file:///ws/a.metta")).toBeUndefined();
    const id = registry.idFor("file:///ws/a.metta");
    expect(registry.peek("file:///ws/a.metta")).toBe(id);
    expect(registry.peek("file:///ws/missing.metta")).toBeUndefined();
    // peek did not grow the interner.
    expect(registry.size()).toBe(1);
  });
});

describe("uri normalization", () => {
  it("is idempotent and round-trips an absolute path", () => {
    const uri = pathToUri("/ws/sub/a.metta");
    expect(normalizeUri(uri)).toBe(uri);
    expect(normalizeUri(normalizeUri(uri))).toBe(normalizeUri(uri));
    expect(uriToPath(uri)).toBe("/ws/sub/a.metta");
  });

  it("leaves a non-file uri untouched and reports no path for it", () => {
    expect(normalizeUri("metta://stdlib/types")).toBe("metta://stdlib/types");
    expect(uriToPath("metta://stdlib/types")).toBeNull();
  });

  it("recognises MeTTa source extensions only", () => {
    expect(isMettaFile("/ws/a.metta")).toBe(true);
    expect(isMettaFile("/ws/a.metta.txt")).toBe(false);
    expect(isMettaFile("/ws/A.METTA")).toBe(true);
    expect(isMettaFile("/ws/a.txt")).toBe(false);
    expect(isMettaFile("/ws/a")).toBe(false);
  });
});
