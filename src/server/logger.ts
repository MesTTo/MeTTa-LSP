// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A small structured logger for the language server, modeled on rust-analyzer's leveled logging. Every line is
// sent to the client over the LSP `window/logMessage` notification (the connection's console), so it is
// IDE-agnostic: VS Code renders it in the "MeTTa Language Server" output channel with per-level colouring and
// filtering, and any other LSP client (Neovim, Helix, Emacs) receives the same notifications. The level gates
// output at the source, so a quiet level does no string work; a context label groups related lines the way a
// tracing span does.

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

// error < warn < info < debug < trace: a message is emitted when its rank is at or below the active level.
const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

// The four severities `window/logMessage` carries. `trace` folds onto `debug`, since the protocol has no finer
// level; the context label still distinguishes trace-intent lines. `connection.console` satisfies this shape.
export interface LogSink {
  error(line: string): void;
  warn(line: string): void;
  info(line: string): void;
  debug(line: string): void;
}

export function parseLogLevel(value: unknown, fallback: LogLevel = "info"): LogLevel {
  return value === "error" ||
    value === "warn" ||
    value === "info" ||
    value === "debug" ||
    value === "trace"
    ? value
    : fallback;
}

export class Logger {
  constructor(
    private readonly sink: LogSink,
    // One shared object so every child logger sees a single setLevel; not exported, only reached via createLogger.
    private readonly config: { level: LogLevel },
    private readonly context?: string,
  ) {}

  // A child logger that tags its lines with `context` and shares this logger's live level.
  child(context: string): Logger {
    return new Logger(this.sink, this.config, context);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  error(message: string, data?: unknown): void {
    this.emit("error", message, data);
  }
  warn(message: string, data?: unknown): void {
    this.emit("warn", message, data);
  }
  info(message: string, data?: unknown): void {
    this.emit("info", message, data);
  }
  debug(message: string, data?: unknown): void {
    this.emit("debug", message, data);
  }
  trace(message: string, data?: unknown): void {
    this.emit("trace", message, data);
  }

  // Time a span: call the returned function when the work finishes to log its wall-clock at debug level. The
  // clock is read only when the level admits debug, so timing is free at info and above.
  time(message: string): () => void {
    if (RANK.debug > RANK[this.config.level]) return () => {};
    const start = performance.now();
    return () => this.emit("debug", `${message} took ${Math.round(performance.now() - start)}ms`);
  }

  private emit(level: LogLevel, message: string, data?: unknown): void {
    if (RANK[level] > RANK[this.config.level]) return;
    const context = this.context === undefined ? "" : `[${this.context}] `;
    const detail = data === undefined ? "" : ` ${render(data)}`;
    const line = `${context}${message}${detail}`;
    if (level === "trace") this.sink.debug(line);
    else this.sink[level](line);
  }
}

// A root logger over `sink`, starting at `level`. The returned config lets the caller flip the level later.
export function createLogger(sink: LogSink, level: LogLevel = "info"): Logger {
  return new Logger(sink, { level });
}

function render(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    // JSON.stringify is typed `string` but returns undefined for a function/symbol; widen so the fallback holds.
    const json = JSON.stringify(data) as string | undefined;
    return json ?? "[unserializable]";
  } catch {
    return "[unserializable]";
  }
}
