// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The repl's line dispatch, run against the real hyperon runner: bang queries evaluate, definitions persist
// across lines, and the `:` meta-commands inspect types and exit.

import { MeTTa } from "@metta-ts/hyperon";
import { beforeEach, describe, expect, it } from "vitest";
import { handleReplLine } from "../repl.js";

describe("handleReplLine", () => {
  let runner: MeTTa;
  beforeEach(() => {
    runner = new MeTTa();
  });

  it("evaluates a bang query", () => {
    expect(handleReplLine(runner, "!(+ 1 2)")).toEqual({ output: "[3]", quit: false });
  });

  it("persists definitions across lines", () => {
    expect(handleReplLine(runner, "(= (double $x) (* 2 $x))").output).toBe("");
    expect(handleReplLine(runner, "!(double 21)").output).toBe("[42]");
  });

  it("reports inferred types with :type", () => {
    expect(handleReplLine(runner, ":type 42").output).toBe("Number");
  });

  it("evaluates an expression with :reduce", () => {
    expect(handleReplLine(runner, ":reduce (+ 1 2)").output).toBe("[3]");
  });

  it("lists commands with :help and exits with :quit", () => {
    expect(handleReplLine(runner, ":help").output).toContain(":quit");
    expect(handleReplLine(runner, ":quit")).toEqual({ output: "", quit: true });
    expect(handleReplLine(runner, ":q").quit).toBe(true);
  });

  it("reports an unknown meta command", () => {
    expect(handleReplLine(runner, ":nope").output).toContain("unknown command");
  });

  it("reports malformed meta-command input without throwing", () => {
    expect(() => handleReplLine(runner, ":type (")).not.toThrow();
    expect(handleReplLine(runner, ":type (").output).toContain("error:");
  });

  it("ignores a blank line", () => {
    expect(handleReplLine(runner, "   ")).toEqual({ output: "", quit: false });
  });
});
