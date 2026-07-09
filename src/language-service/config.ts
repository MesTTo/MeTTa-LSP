// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The project configuration, written in MeTTa itself (`lint.metta`). MeTTa is the config language so a repo
// pins one canonical style and lint policy in the same notation it programs in, following the convention of
// the user's own lint module (`(lint-severity <rule> <level>)`). Directives are flat top-level forms:
//
//   (format-width 100)                 ; printer target width
//   (format-indent 2)                  ; block indent step
//   (format-block-form match 2)        ; `match` keeps 2 setup args on the head line, body indents below
//   (format-align-form ==)             ; `==` aligns its operands under the first (a symmetric form)
//   (lint-preset strict)               ; severity preset
//   (lint-severity missing-type-decl off)   ; per-rule override
//
// Parsing never throws: a malformed file yields the safe defaults plus a list of `issues` (syntax errors and
// unrecognised or ill-typed directives) that the editor surfaces as diagnostics on `lint.metta` itself.

import { type Cst, parseCst, type SpannedNode, standardTokenizer } from "@metta-ts/core";

export type LintSeverity = "deny" | "warn" | "allow" | "off";
export type LintPreset = "pedagogical" | "permissive" | "standard" | "strict" | "knowledge-base";

export interface FormatConfig {
  readonly width?: number;
  readonly indent?: number;
  // Extra block forms: head symbol → how many leading arguments stay on the head line before the body indents.
  readonly blockForms: Readonly<Record<string, number>>;
  // Extra symmetric forms whose arguments align under the first.
  readonly alignForms: readonly string[];
}

export interface LintConfig {
  readonly preset?: LintPreset;
  readonly severities: Readonly<Record<string, LintSeverity>>;
}

export interface ConfigIssue {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface MettaConfig {
  readonly format: FormatConfig;
  readonly lint: LintConfig;
  readonly issues: readonly ConfigIssue[];
}

const TOKENIZER = standardTokenizer();
const LINT_SEVERITIES = new Set<string>(["deny", "warn", "allow", "off"]);
const LINT_PRESETS = new Set<string>([
  "pedagogical",
  "permissive",
  "standard",
  "strict",
  "knowledge-base",
]);

export const EMPTY_CONFIG: MettaConfig = {
  format: { blockForms: {}, alignForms: [] },
  lint: { severities: {} },
  issues: [],
};

// A non-negative integer with a leading sign forbidden and no fractional part, so config numbers are exact.
function nonNegativeInt(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined;
  const value = Number.parseInt(text, 10);
  return Number.isSafeInteger(value) ? value : undefined;
}

export function parseMettaConfig(src: string): MettaConfig {
  const cst: Cst = parseCst(src, TOKENIZER);
  const format: {
    width?: number;
    indent?: number;
    blockForms: Record<string, number>;
    alignForms: string[];
  } = { blockForms: {}, alignForms: [] };
  const lint: { preset?: LintPreset; severities: Record<string, LintSeverity> } = {
    severities: {},
  };
  const issues: ConfigIssue[] = [];

  // Syntax errors from the reader are issues too, so a broken config file is reported rather than silently
  // reverting to defaults.
  for (const diagnostic of cst.diagnostics) {
    issues.push({
      message: diagnostic.message,
      start: diagnostic.span.start,
      end: diagnostic.span.end,
    });
  }

  const leaf = (node: SpannedNode): string => src.slice(node.span.start, node.span.end);
  const problem = (node: SpannedNode, message: string): void => {
    issues.push({ message, start: node.span.start, end: node.span.end });
  };

  // A block form directive `(format-block-form <symbol> <count>)`: record the head-line argument count, or
  // report exactly what was wrong with the arguments.
  const readBlockForm = (node: SpannedNode, args: readonly SpannedNode[]): void => {
    const [symbol, count] = args;
    if (symbol === undefined || count === undefined || args.length !== 2) {
      problem(node, "format-block-form expects a symbol and a count: (format-block-form match 2)");
      return;
    }
    const n = nonNegativeInt(leaf(count));
    if (n === undefined) {
      problem(count, `format-block-form count must be a non-negative integer, got ${leaf(count)}`);
      return;
    }
    format.blockForms[leaf(symbol)] = n;
  };

  const readIntSetting = (
    node: SpannedNode,
    args: readonly SpannedNode[],
    name: string,
    assign: (value: number) => void,
  ): void => {
    const [value] = args;
    if (value === undefined || args.length !== 1) {
      problem(node, `${name} expects a single integer: (${name} 2)`);
      return;
    }
    const n = nonNegativeInt(leaf(value));
    if (n === undefined)
      problem(value, `${name} must be a non-negative integer, got ${leaf(value)}`);
    else assign(n);
  };

  for (const node of cst.nodes) {
    if (node.kind !== "expr") continue;
    const children = node.children ?? [];
    const [head, ...args] = children;
    if (head === undefined || head.kind !== "symbol") continue;
    const directive = leaf(head);
    switch (directive) {
      case "format-width":
        readIntSetting(node, args, "format-width", (v) => {
          format.width = v;
        });
        break;
      case "format-indent":
        readIntSetting(node, args, "format-indent", (v) => {
          format.indent = v;
        });
        break;
      case "format-block-form":
        readBlockForm(node, args);
        break;
      case "format-align-form": {
        const [symbol] = args;
        if (symbol === undefined || args.length !== 1)
          problem(node, "format-align-form expects one symbol: (format-align-form ==)");
        else format.alignForms.push(leaf(symbol));
        break;
      }
      case "lint-preset": {
        const [name] = args;
        if (name === undefined || args.length !== 1) problem(node, "lint-preset expects one name");
        else if (!LINT_PRESETS.has(leaf(name)))
          problem(
            name,
            `unknown lint preset ${leaf(name)} (expected one of ${[...LINT_PRESETS].join(", ")})`,
          );
        else lint.preset = leaf(name) as LintPreset;
        break;
      }
      case "lint-severity": {
        const [rule, level] = args;
        if (rule === undefined || level === undefined || args.length !== 2)
          problem(node, "lint-severity expects a rule and a level: (lint-severity <rule> off)");
        else if (!LINT_SEVERITIES.has(leaf(level)))
          problem(level, `unknown severity ${leaf(level)} (expected deny, warn, allow, or off)`);
        else lint.severities[leaf(rule)] = leaf(level) as LintSeverity;
        break;
      }
      case "lint-rule":
        // Custom lint rules live in the same file but are compiled by the lint engine, not the config reader.
        break;
      default:
        problem(head, `unknown config directive: ${directive}`);
    }
  }

  return {
    format: {
      ...(format.width === undefined ? {} : { width: format.width }),
      ...(format.indent === undefined ? {} : { indent: format.indent }),
      blockForms: format.blockForms,
      alignForms: format.alignForms,
    },
    lint: {
      ...(lint.preset === undefined ? {} : { preset: lint.preset }),
      severities: lint.severities,
    },
    issues,
  };
}
