// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { flagValue, positionalArgs } from "../args.js";

describe("CLI arguments", () => {
  it("keeps operands independent of boolean flag position", () => {
    expect(positionalArgs(["--json", "program.metta", "5", "10"])).toStrictEqual([
      "program.metta",
      "5",
      "10",
    ]);
  });

  it("removes value-taking flags and their values from operands", () => {
    expect(
      positionalArgs(["--max", "50", "program.metta", "(+ 1 2)", "--out", "trace.html"]),
    ).toStrictEqual(["program.metta", "(+ 1 2)"]);
  });

  it("reads separate and inline flag values", () => {
    expect(flagValue(["--port", "6000"], "--port")).toBe("6000");
    expect(flagValue(["--port=6001"], "--port")).toBe("6001");
  });
});
