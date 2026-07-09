// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pathMatchesWorkspaceExclude } from "../pathFilters.js";

describe("pathMatchesWorkspaceExclude", () => {
  it("matches exclude fragments only on path boundaries", () => {
    expect(pathMatchesWorkspaceExclude("/ws/test/main.metta", ["test"])).toBe(true);
    expect(pathMatchesWorkspaceExclude("/ws/latest/main.metta", ["test"])).toBe(false);
    expect(pathMatchesWorkspaceExclude("/ws/contest/main.metta", ["test"])).toBe(false);
  });

  it("matches cleaned glob-like directory fragments", () => {
    expect(
      pathMatchesWorkspaceExclude("/ws/docs-site/.vitepress/dist/app.js", [
        "**/.vitepress/dist/**",
      ]),
    ).toBe(true);
    expect(
      pathMatchesWorkspaceExclude("/ws/docs-site/.vitepress-distribution/app.js", [
        "**/.vitepress/dist/**",
      ]),
    ).toBe(false);
  });

  it("supports file and directory wildcards", () => {
    expect(pathMatchesWorkspaceExclude("/ws/assets/app.min.js", ["**/*.min.js"])).toBe(true);
    expect(pathMatchesWorkspaceExclude("/ws/cache-a/item.metta", ["cache-?"])).toBe(true);
    expect(pathMatchesWorkspaceExclude("/ws/cache-long/item.metta", ["cache-?"])).toBe(false);
  });

  it("can match browser paths case-insensitively", () => {
    expect(
      pathMatchesWorkspaceExclude("/WS/Node_Modules/pkg/a.metta", ["node_modules"], {
        caseSensitive: false,
      }),
    ).toBe(true);
  });
});
