// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathIsInsideWorkspace } from "../workspacePath.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("pathIsInsideWorkspace", () => {
  it("rejects a workspace symlink that resolves outside the root", () => {
    const tempRoot = join(process.cwd(), "ai-tmp");
    mkdirSync(tempRoot, { recursive: true });
    const directory = mkdtempSync(join(tempRoot, "workspace-boundary-"));
    created.push(directory);
    const workspace = join(directory, "workspace");
    const outside = join(directory, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.metta"), "(: secret Type)");
    symlinkSync(
      outside,
      join(workspace, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    expect(pathIsInsideWorkspace(workspace, join(workspace, "escape", "secret.metta"))).toBe(false);
    expect(pathIsInsideWorkspace(workspace, join(workspace, "local.metta"))).toBe(true);
    expect(pathIsInsideWorkspace(workspace, join(workspace, "..cache", "local.metta"))).toBe(true);
  });
});
