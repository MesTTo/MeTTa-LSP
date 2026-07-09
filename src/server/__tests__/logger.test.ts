// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { createLogger, type LogLevel, type LogSink, parseLogLevel } from "../logger.js";

function recordingSink(): { lines: string[]; sink: LogSink } {
  const lines: string[] = [];
  const push =
    (level: string) =>
    (line: string): void => {
      lines.push(`${level}: ${line}`);
    };
  return {
    lines,
    sink: { error: push("error"), warn: push("warn"), info: push("info"), debug: push("debug") },
  };
}

describe("structured logger", () => {
  it("emits at or below the active level and drops the rest", () => {
    const { lines, sink } = recordingSink();
    const log = createLogger(sink, "info");
    log.error("e");
    log.warn("w");
    log.info("i");
    log.debug("d");
    log.trace("t");
    expect(lines).toEqual(["error: e", "warn: w", "info: i"]);
  });

  it("emits everything at trace, routing trace onto the debug sink", () => {
    const { lines, sink } = recordingSink();
    const log = createLogger(sink, "trace");
    log.debug("d");
    log.trace("t");
    expect(lines).toEqual(["debug: d", "debug: t"]);
  });

  it("tags a child logger's lines with its context", () => {
    const { lines, sink } = recordingSink();
    createLogger(sink, "info").child("validate").info("done");
    expect(lines).toEqual(["info: [validate] done"]);
  });

  it("renders structured data as JSON and passes strings through", () => {
    const { lines, sink } = recordingSink();
    const log = createLogger(sink, "info");
    log.info("count", { files: 3 });
    log.info("note", "plain");
    expect(lines).toEqual(['info: count {"files":3}', "info: note plain"]);
  });

  it("shares the live level across children when it changes", () => {
    const { lines, sink } = recordingSink();
    const root = createLogger(sink, "info");
    const child = root.child("engine");
    child.debug("hidden");
    root.setLevel("debug");
    child.debug("shown");
    expect(lines).toEqual(["debug: [engine] shown"]);
  });

  it("times a span at debug, and is a no-op above debug", () => {
    const { lines, sink } = recordingSink();
    const debugLog = createLogger(sink, "debug");
    debugLog.time("work")();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^debug: work took \d+ms$/);

    const { lines: quiet, sink: quietSink } = recordingSink();
    createLogger(quietSink, "info").time("work")();
    expect(quiet).toEqual([]);
  });

  it("parses a log level, falling back on anything unexpected", () => {
    expect(parseLogLevel("debug")).toBe<LogLevel>("debug");
    expect(parseLogLevel("nonsense")).toBe<LogLevel>("info");
    expect(parseLogLevel(undefined, "warn")).toBe<LogLevel>("warn");
  });
});
