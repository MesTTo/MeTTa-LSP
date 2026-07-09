// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The MeTTa-native project config parser: every directive maps to the right setting, and every malformed
// input becomes an issue rather than throwing or silently reverting to a default.

import { describe, expect, it } from "vitest";
import { parseMettaConfig } from "../config.js";

describe("parseMettaConfig", () => {
  it("returns safe defaults for empty input with no issues", () => {
    const config = parseMettaConfig("");
    expect(config.format).toEqual({ blockForms: {}, alignForms: [] });
    expect(config.lint).toEqual({ severities: {} });
    expect(config.issues).toEqual([]);
  });

  it("reads width and indent as integers", () => {
    const config = parseMettaConfig("(format-width 100)\n(format-indent 4)");
    expect(config.format.width).toBe(100);
    expect(config.format.indent).toBe(4);
    expect(config.issues).toEqual([]);
  });

  it("reads block forms as symbol → head-line-arg count", () => {
    const config = parseMettaConfig("(format-block-form match 2)\n(format-block-form my-macro 1)");
    expect(config.format.blockForms).toEqual({ match: 2, "my-macro": 1 });
  });

  it("reads align forms as a list of symbols", () => {
    const config = parseMettaConfig("(format-align-form ==)\n(format-align-form <->)");
    expect(config.format.alignForms).toEqual(["==", "<->"]);
  });

  it("reads a lint preset and per-rule severities", () => {
    const config = parseMettaConfig(
      "(lint-preset strict)\n(lint-severity missing-type-decl off)\n(lint-severity circular-subtype deny)",
    );
    expect(config.lint.preset).toBe("strict");
    expect(config.lint.severities).toEqual({
      "missing-type-decl": "off",
      "circular-subtype": "deny",
    });
  });

  it("rejects a non-integer width but keeps parsing the rest", () => {
    const config = parseMettaConfig("(format-width wide)\n(format-indent 2)");
    expect(config.format.width).toBeUndefined();
    expect(config.format.indent).toBe(2);
    expect(config.issues).toHaveLength(1);
    expect(config.issues[0]?.message).toContain("format-width");
  });

  it("rejects negative and fractional numbers", () => {
    const config = parseMettaConfig("(format-width -5)\n(format-indent 2.5)");
    expect(config.format.width).toBeUndefined();
    expect(config.format.indent).toBeUndefined();
    expect(config.issues).toHaveLength(2);
  });

  it("flags an unknown severity level", () => {
    const config = parseMettaConfig("(lint-severity my-rule loud)");
    expect(config.lint.severities).toEqual({});
    expect(config.issues[0]?.message).toContain("unknown severity");
  });

  it("flags an unknown preset", () => {
    const config = parseMettaConfig("(lint-preset ultra)");
    expect(config.lint.preset).toBeUndefined();
    expect(config.issues[0]?.message).toContain("unknown lint preset");
  });

  it("flags an unknown directive with its name", () => {
    const config = parseMettaConfig("(format-widht 80)");
    expect(config.issues).toHaveLength(1);
    expect(config.issues[0]?.message).toContain("unknown config directive: format-widht");
  });

  it("flags a block form missing its count", () => {
    const config = parseMettaConfig("(format-block-form match)");
    expect(config.format.blockForms).toEqual({});
    expect(config.issues[0]?.message).toContain("format-block-form");
  });

  it("carries syntax errors from the reader through as issues", () => {
    const config = parseMettaConfig("(format-width 80");
    expect(config.issues.length).toBeGreaterThan(0);
  });

  it("ignores comments and blank lines", () => {
    const config = parseMettaConfig("; my project style\n\n(format-width 90)\n; trailing note\n");
    expect(config.format.width).toBe(90);
    expect(config.issues).toEqual([]);
  });

  it("never throws on arbitrary text", () => {
    for (const src of [")))", "(((", '(format-width "80")', "$x", "(a (b (c", ""]) {
      expect(() => parseMettaConfig(src)).not.toThrow();
    }
  });
});
