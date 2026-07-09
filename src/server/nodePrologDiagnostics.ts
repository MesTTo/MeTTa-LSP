// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// SWI-Prolog syntax diagnostics for referenced `.pl` files. This reads terms instead of consulting the file:
// diagnostics must not execute arbitrary directives or mutate a Prolog database. The only directive it applies
// is op/3, because later terms can be syntactically valid only after an operator declaration.

import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import type {
  PrologDiagnosticProvider,
  PrologDiagnosticSettings,
  PrologSourceDiagnostic,
} from "./prologDiagnostics.js";

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

const READ_ONLY_GOAL =
  "current_prolog_flag(argv,[File])," +
  "setup_call_cleanup(open(File,read,S)," +
  "(repeat,read_term(S,T,[syntax_errors(error),term_position(_),variable_names(_)])," +
  "(T==end_of_file->!;(T=(:- op(P,O,N))->catch(op(P,O,N),_,true);true),fail)),close(S))";

interface CacheEntry {
  readonly key: string;
  readonly diagnostics: readonly PrologSourceDiagnostic[];
}

export class NodePrologDiagnosticProvider implements PrologDiagnosticProvider {
  private readonly cache = new Map<string, CacheEntry>();

  public diagnosticsForFile(
    filePath: string,
    settings: PrologDiagnosticSettings,
  ): readonly PrologSourceDiagnostic[] {
    const { executable, key } = this.cacheKey(filePath, settings);
    const cached = this.cached(filePath, key);
    if (cached !== null) return cached;
    const diagnostics = this.checkFile(filePath, executable, settings.timeoutMs);
    this.cacheResult(filePath, key, diagnostics);
    return diagnostics;
  }

  public async diagnosticsForFileAsync(
    filePath: string,
    settings: PrologDiagnosticSettings,
    signal?: AbortSignal,
  ): Promise<readonly PrologSourceDiagnostic[]> {
    if (isAborted(signal)) return [];
    const { executable, key } = this.cacheKey(filePath, settings);
    const cached = this.cached(filePath, key);
    if (cached !== null) return cached;
    const diagnostics = await this.checkFileAsync(filePath, executable, settings.timeoutMs, signal);
    if (!isAborted(signal)) this.cacheResult(filePath, key, diagnostics);
    return diagnostics;
  }

  private cacheKey(
    filePath: string,
    settings: PrologDiagnosticSettings,
  ): { executable: string; key: string } {
    const executable = settings.executable.trim() || "swipl";
    return { executable, key: `${executable}\0${settings.timeoutMs}\0${this.statKey(filePath)}` };
  }

  private cached(filePath: string, key: string): readonly PrologSourceDiagnostic[] | null {
    const cached = this.cache.get(filePath);
    return cached?.key === key ? cached.diagnostics : null;
  }

  private cacheResult(
    filePath: string,
    key: string,
    diagnostics: readonly PrologSourceDiagnostic[],
  ): void {
    this.cache.set(filePath, { key, diagnostics });
  }

  private statKey(filePath: string): string {
    try {
      const stat = statSync(filePath);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "missing";
    }
  }

  private checkFile(
    filePath: string,
    executable: string,
    timeoutMs: number,
  ): readonly PrologSourceDiagnostic[] {
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync(
        executable,
        ["-q", "-f", "none", "-g", READ_ONLY_GOAL, "-t", "halt", "--", filePath],
        {
          encoding: "utf8",
          timeout: Math.max(100, timeoutMs),
          windowsHide: true,
        },
      );
    } catch (error) {
      return [backendDiagnostic(errorMessage(error))];
    }
    if (result.error !== undefined) {
      return [
        backendDiagnostic(
          result.error.message.includes("ETIMEDOUT")
            ? `SWI-Prolog diagnostics timed out after ${Math.max(100, timeoutMs)} ms`
            : result.error.message,
          result.error.message.includes("ETIMEDOUT") ? "prolog.timeout" : "prolog.backend",
        ),
      ];
    }
    return parseSwiRunResult(
      filePath,
      `${String(result.stderr)}\n${String(result.stdout)}`,
      result.status,
    );
  }

  private checkFileAsync(
    filePath: string,
    executable: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<readonly PrologSourceDiagnostic[]> {
    return new Promise((resolve) => {
      const timeout = Math.max(100, timeoutMs);
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          executable,
          ["-q", "-f", "none", "-g", READ_ONLY_GOAL, "-t", "halt", "--", filePath],
          {
            windowsHide: true,
          },
        );
      } catch (error) {
        resolve([backendDiagnostic(errorMessage(error))]);
        return;
      }
      let stdout = "";
      let stderr = "";
      let settled = false;
      function finish(diagnostics: readonly PrologSourceDiagnostic[]): void {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        resolve(diagnostics);
      }
      function abort(): void {
        child.kill();
        finish([]);
      }
      const timer = setTimeout(() => {
        child.kill();
        finish([
          backendDiagnostic(
            `SWI-Prolog diagnostics timed out after ${timeout} ms`,
            "prolog.timeout",
          ),
        ]);
      }, timeout);
      if (isAborted(signal)) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        finish([backendDiagnostic(error.message)]);
      });
      child.once("close", (code) => {
        finish(parseSwiRunResult(filePath, `${stderr}\n${stdout}`, code));
      });
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function backendDiagnostic(message: string, code = "prolog.backend"): PrologSourceDiagnostic {
  return {
    line: 0,
    character: 0,
    severity: DiagnosticSeverity.Warning,
    code,
    message: `SWI-Prolog diagnostics unavailable: ${message}`,
  };
}

export function parseSwiDiagnostics(
  filePath: string,
  output: string,
): readonly PrologSourceDiagnostic[] {
  const diagnostics: PrologSourceDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const severity = line.startsWith("ERROR:")
      ? DiagnosticSeverity.Error
      : line.startsWith("Warning:")
        ? DiagnosticSeverity.Warning
        : undefined;
    if (severity === undefined) continue;
    const marker = `${filePath}:`;
    const index = line.lastIndexOf(marker);
    if (index === -1) continue;
    const detail = line.slice(index + marker.length);
    const match = /^(\d+)(?::(\d+))?: ?(.*)$/.exec(detail);
    if (match === null) continue;
    const lineNumber = Math.max(0, Number(match[1]) - 1);
    const column = match[2] === undefined ? 0 : Math.max(0, Number(match[2]) - 1);
    const message = match[3]?.trim() ?? "Prolog diagnostic";
    diagnostics.push({
      line: lineNumber,
      character: column,
      severity,
      code: severity === DiagnosticSeverity.Error ? "prolog.syntax" : "prolog.warning",
      message,
    });
  }
  return diagnostics;
}

export function parseSwiRunResult(
  filePath: string,
  output: string,
  status: number | null,
): readonly PrologSourceDiagnostic[] {
  const parsed = parseSwiDiagnostics(filePath, output);
  if (parsed.length > 0 || status === 0) return parsed;
  const generic = genericSwiMessage(output);
  return [
    backendDiagnostic(
      generic ?? `SWI-Prolog exited with status ${status === null ? "unknown" : status}`,
    ),
  ];
}

function genericSwiMessage(output: string): string | null {
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("ERROR:")) return line.slice("ERROR:".length).trim();
    if (line.startsWith("Warning:")) return line.slice("Warning:".length).trim();
  }
  return null;
}
