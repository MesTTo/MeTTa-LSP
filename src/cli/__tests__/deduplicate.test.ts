// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deduplicatePaths, renderDeduplicate } from "../deduplicate.js";

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(process.cwd(), "ai-tmp-deduplicate-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deduplicate CLI service", () => {
  it("discovers MeTTa files, honors ignores, and renders locations", () => {
    const root = temporaryRoot();
    writeFileSync(join(root, "a.metta"), "!(f A B)\n");
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, "nested", "b.metta"), "!(f A B)\n");
    writeFileSync(join(root, "nested", "ignored.metta"), "!(f A B)\n");
    writeFileSync(join(root, "nested", "note.txt"), "!(f A B)\n");

    const result = deduplicatePaths([root], {
      minAtoms: 3,
      ignore: ["**/ignored.metta"],
    });

    expect(result.complete).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.clones).toHaveLength(1);
    expect(renderDeduplicate(result)).toContain("a.metta:1:2");
    expect(renderDeduplicate(result)).toContain("1 clone");
  });

  it("honors explicit files even when they exceed the directory size cap", () => {
    const root = temporaryRoot();
    const file = join(root, "large.metta");
    writeFileSync(file, "!(long expression here)\n!(long expression here)\n");

    const result = deduplicatePaths([file], { minAtoms: 3, maxFileBytes: 1 });

    expect(result.complete).toBe(true);
    expect(result.files).toEqual([file]);
    expect(result.clones).toHaveLength(1);
  });

  it("marks capped or malformed directory scans incomplete", () => {
    const root = temporaryRoot();
    writeFileSync(join(root, "a.metta"), "!(f A)\n");
    writeFileSync(join(root, "b.metta"), "!(f A\n");

    const capped = deduplicatePaths([root], { maxFiles: 1 });
    expect(capped.complete).toBe(false);
    expect(capped.scanIssues).toContainEqual(expect.objectContaining({ code: "max-files" }));

    const malformed = deduplicatePaths([root], { maxFiles: 10 });
    expect(malformed.complete).toBe(false);
    expect(malformed.issues).toHaveLength(1);
  });
});
