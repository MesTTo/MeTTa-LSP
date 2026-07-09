// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import {
  NodePrologDiagnosticProvider,
  parseSwiDiagnostics,
  parseSwiRunResult,
} from "../nodePrologDiagnostics.js";

const hasSwipl = spawnSync("swipl", ["--version"], { encoding: "utf8" }).status === 0;

describe("parseSwiDiagnostics", () => {
  it("maps SWI syntax errors to zero-based LSP positions", () => {
    expect(
      parseSwiDiagnostics(
        "/tmp/facts.pl",
        "ERROR: -g <goal>: /tmp/facts.pl:2:22: Syntax error: Unexpected end of file\n",
      ),
    ).toStrictEqual([
      {
        line: 1,
        character: 21,
        severity: DiagnosticSeverity.Error,
        code: "prolog.syntax",
        message: "Syntax error: Unexpected end of file",
      },
    ]);
  });

  it("ignores diagnostics for other files", () => {
    expect(
      parseSwiDiagnostics(
        "/tmp/facts.pl",
        "ERROR: /tmp/other.pl:1:1: Syntax error: Operator expected\n",
      ),
    ).toStrictEqual([]);
  });

  it("turns SWI failures without file positions into backend diagnostics", () => {
    const diagnostics = parseSwiRunResult(
      "/tmp/facts.pl",
      "ERROR: -g <goal>: open/3: source_sink `/tmp/facts.pl' does not exist\n",
      2,
    );
    expect(diagnostics).toStrictEqual([
      {
        line: 0,
        character: 0,
        severity: DiagnosticSeverity.Warning,
        code: "prolog.backend",
        message:
          "SWI-Prolog diagnostics unavailable: -g <goal>: open/3: source_sink `/tmp/facts.pl' does not exist",
      },
    ]);
  });

  it("surfaces malformed executable values as backend diagnostics", () => {
    const provider = new NodePrologDiagnosticProvider();
    const diagnostics = provider.diagnosticsForFile("/tmp/facts.pl", {
      executable: "bad\0exe",
      timeoutMs: 100,
    });
    expect(diagnostics[0]?.code).toBe("prolog.backend");
  });

  it("uses the async provider path without throwing malformed executable values", async () => {
    const provider = new NodePrologDiagnosticProvider();
    const diagnostics = await provider.diagnosticsForFileAsync("/tmp/facts.pl", {
      executable: "bad\0exe",
      timeoutMs: 100,
    });
    expect(diagnostics[0]?.code).toBe("prolog.backend");
  });

  it("does not spawn or cache diagnostics for an already-cancelled request", async () => {
    const provider = new NodePrologDiagnosticProvider();
    const controller = new AbortController();
    controller.abort();
    const settings = { executable: "bad\0exe", timeoutMs: 100 };

    await expect(
      provider.diagnosticsForFileAsync("/tmp/facts.pl", settings, controller.signal),
    ).resolves.toStrictEqual([]);
    const next = await provider.diagnosticsForFileAsync("/tmp/facts.pl", settings);
    expect(next[0]?.code).toBe("prolog.backend");
  });

  it.runIf(hasSwipl)("applies op/3 directives before reading later terms", () => {
    const tempRoot = join(process.cwd(), "ai-tmp");
    mkdirSync(tempRoot, { recursive: true });
    const dir = mkdtempSync(join(tempRoot, "prolog-"));
    const file = join(dir, "facts.pl");
    try {
      writeFileSync(file, ":- op(500, xfy, ==>).\na ==> b.\n");
      const provider = new NodePrologDiagnosticProvider();
      expect(
        provider.diagnosticsForFile(file, { executable: "swipl", timeoutMs: 5_000 }),
      ).toStrictEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
