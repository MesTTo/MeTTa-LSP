// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Discovers and loads the nearest `lint.metta` for a document by walking up its directory chain (the way
// Prettier finds .prettierrc and ESLint cascades its config). The pure parse lives in the language-service;
// this adds the I/O: find the file through the host FileProvider, then parse both its config directives and
// its (lint-rule ...) definitions, caching by the config file's modification time so repeated queries on the
// hot path neither re-read nor re-parse an unchanged config.

import { dirname, join, normalize } from "pathe";
import {
  EMPTY_CONFIG,
  type LintRule,
  type MettaConfig,
  parseMettaConfig,
  parseRules,
  type SuppressRule,
} from "../language-service/index.js";
import type { FileProvider } from "./fileProvider.js";

const CONFIG_FILENAME = "lint.metta";

export interface ResolvedConfig {
  readonly config: MettaConfig;
  readonly rules: readonly LintRule[];
  readonly suppresses: readonly SuppressRule[];
}

const EMPTY_RESOLVED: ResolvedConfig = { config: EMPTY_CONFIG, rules: [], suppresses: [] };

export class ConfigLoader {
  private readonly cache = new Map<
    string,
    { readonly mtimeMs: number; readonly resolved: ResolvedConfig }
  >();

  public constructor(private readonly files: FileProvider) {}

  // The config directives governing a source file (used by the formatter).
  public loadForFile(fsPath: string): MettaConfig {
    return this.resolveForFile(fsPath).config;
  }

  // The project's custom lint rules for a source file (used by the linter).
  public rulesForFile(fsPath: string): readonly LintRule[] {
    return this.resolveForFile(fsPath).rules;
  }

  // The project's code-as-data suppressions for a source file (used by the diagnostics filter).
  public suppressesForFile(fsPath: string): readonly SuppressRule[] {
    return this.resolveForFile(fsPath).suppresses;
  }

  // Both, from the nearest lint.metta at or above the file's directory, or the empty resolution when none.
  public resolveForFile(fsPath: string): ResolvedConfig {
    const configPath = this.findConfig(dirname(normalize(fsPath)));
    return configPath === null ? EMPTY_RESOLVED : this.parseCached(configPath);
  }

  // The nearest lint.metta walking up from `startDir` to the filesystem root, or null if there is none. Not
  // cached: a config added in a parent directory must be picked up on the next query.
  private findConfig(startDir: string): string | null {
    let dir = startDir;
    for (;;) {
      const candidate = join(dir, CONFIG_FILENAME);
      if (this.files.stat(candidate)?.isFile === true) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  private parseCached(configPath: string): ResolvedConfig {
    const mtimeMs = this.files.stat(configPath)?.mtimeMs ?? 0;
    const cached = this.cache.get(configPath);
    if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.resolved;
    const content = this.files.readFile(configPath);
    let resolved: ResolvedConfig = EMPTY_RESOLVED;
    if (content !== null) {
      const parsed = parseRules(content);
      resolved = {
        config: parseMettaConfig(content),
        rules: parsed.rules,
        suppresses: parsed.suppresses,
      };
    }
    this.cache.set(configPath, { mtimeMs, resolved });
    return resolved;
  }

  // Drop cached parses so the next query re-reads from disk. Called when a lint.metta file changes.
  public invalidate(): void {
    this.cache.clear();
  }
}
