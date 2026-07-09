// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// An ergonomic TypeScript API over the language server. Instead of wiring an Analyzer and a file
// provider, you call a function on a string of MeTTa and get structured results:
//
//   import { lint, diagnostics, format, hover, run } from "metta-ts-lsp/dsl";
//   lint("(= (f $x) (if True 1 2))");         // → the lint findings
//   diagnostics("(fatc 5)");                   // → the diagnostics
//   format("(=   (f $x)   $x)");               // → the formatted source
//   await run("(= (f $x) (* $x 2))\n!(f 21)"); // → the evaluation results
//
// Or hold one document and query it repeatedly without re-parsing:
//
//   const doc = metta(source);
//   doc.hover(10);            // by character offset
//   doc.hover({ line: 0, character: 3 });   // or an LSP position
//   doc.symbols();
//
// Positions accept an LSP `{ line, character }` (0-based) or a plain character offset into the source.
// The whole surface is the analyzer's, exposed without ceremony.

import type {
  CodeAction,
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  Position,
  Range,
} from "vscode-languageserver-types";
import { type FormatOptions, formatMetta } from "../formatter/formatMetta.js";
import {
  type LintFinding,
  type StructuralMatch,
  structuralReplace,
  structuralSearch,
} from "../language-service/index.js";
import { evaluateUnguarded, type UnguardedRunOptions } from "../runtime/guardedEvaluation.js";
import { Analyzer, type SuppressedDiagnostic } from "../server/analyzer.js";
import { InMemoryFileProvider } from "../server/fileProvider.js";
import type { GuardedEvaluationResult } from "../server/guardedEvaluationTypes.js";
import { computeLineOffsets, positionAt } from "../server/parser.js";

const ROOT = "inmemory://metta-dsl";
const DOC_URI = `${ROOT}/doc.metta`;

// A location in the source: an LSP position (0-based line/character) or a plain character offset.
export type Loc = Position | number;

// A one-document handle over the analyzer. Build it with `metta(source)` (or `MettaDoc.of`) for a fresh
// in-memory document, or `MettaDoc.over(analyzer, uri)` to wrap an existing, already-configured analyzer
// (how the disk-aware CLI reuses this ergonomic surface). Every method mirrors a language-server feature
// and returns its native result.
export class MettaDoc {
  readonly analyzer: Analyzer;
  readonly uri: string;
  readonly source: string;
  private readonly lineOffsets: readonly number[];

  private constructor(analyzer: Analyzer, uri: string, source: string) {
    this.analyzer = analyzer;
    this.uri = uri;
    this.source = source;
    this.lineOffsets = computeLineOffsets(source);
  }

  /** A fresh in-memory document with its own analyzer. */
  static of(source: string, uri: string = DOC_URI): MettaDoc {
    const analyzer = new Analyzer(new InMemoryFileProvider("/"));
    analyzer.setWorkspaceRoots([ROOT]);
    analyzer.updateDocument(uri, source, 1, true);
    return new MettaDoc(analyzer, uri, source);
  }

  /** Wrap one document of an existing analyzer — the disk-aware CLI uses this so project config,
   *  workspace imports, and the host bridge stay in effect behind the ergonomic methods. */
  static over(analyzer: Analyzer, uri: string): MettaDoc {
    return new MettaDoc(analyzer, uri, analyzer.getDocument(uri)?.text ?? "");
  }

  private position(loc: Loc): Position {
    return typeof loc === "number" ? positionAt(loc, this.lineOffsets) : loc;
  }

  private toRange(at: Loc | Range): Range {
    if (typeof at === "object" && "start" in at) return at;
    const pos = this.position(at);
    return { start: pos, end: pos };
  }

  /** Diagnostics: syntax, undefined symbols, arity, type, import, and lint findings mapped to ranges. */
  diagnostics(): Diagnostic[] {
    return this.analyzer.validate(this.uri);
  }

  /** Diagnostics a suppression silenced, each with the reason (which `; @suppress` or `(suppress ...)`). */
  suppressed(): SuppressedDiagnostic[] {
    return this.analyzer.suppressedDiagnostics(this.uri);
  }

  /** Lint findings (rule id, message, severity, span) from the built-in pack plus any lint.metta rules. */
  lint(): LintFinding[] {
    return this.analyzer.lintFindings(this.uri);
  }

  /** Structural search: every form whose structure matches a MeTTa pattern (code as data, not a regex). */
  search(pattern: string): StructuralMatch[] {
    return structuralSearch(this.source, pattern);
  }

  /** Structural replace: rewrite every match of a pattern with a template, substituting the captures. */
  replace(pattern: string, template: string): string {
    return structuralReplace(this.source, pattern, template).text;
  }

  /** The source reformatted by the width-driven pretty-printer. */
  format(options: FormatOptions = {}): string {
    return formatMetta(this.source, options);
  }

  /** The hover card (markdown) at a position, or null. */
  hover(at: Loc): Hover | null {
    return this.analyzer.hover(this.uri, this.position(at));
  }

  /** Definition locations for the symbol at a position. */
  definition(at: Loc): Location[] {
    return this.analyzer.definition(this.uri, this.position(at));
  }

  /** Reference locations for the symbol at a position. */
  references(at: Loc, includeDeclaration = true): Location[] {
    return this.analyzer.references(this.uri, this.position(at), includeDeclaration);
  }

  /** The document's hierarchical symbols. */
  symbols(): DocumentSymbol[] {
    return this.analyzer.documentSymbols(this.uri);
  }

  /** Completions at a position. */
  completions(at: Loc): CompletionItem[] {
    return this.analyzer.completions(this.uri, this.position(at));
  }

  /** Code actions (quick fixes, run, add-type suggestion) at a position or over a range. */
  codeActions(at: Loc | Range): CodeAction[] {
    return this.analyzer.codeActions(this.uri, this.toRange(at));
  }

  /** A plain-language / structural reading of the form at a position. */
  explain(at: Loc): { readonly text: string; readonly kind: string } | null {
    return this.analyzer.explainAt(this.uri, this.position(at));
  }

  /** Each top-level form rendered as mixfix pseudocode, in document order. */
  pseudocode(): string[] {
    const enabled = this.analyzer.getSettings().pseudocode.enabled;
    this.analyzer.updateSettings({ pseudocode: { enabled: true } });
    const lenses = this.analyzer.codeLenses(this.uri);
    this.analyzer.updateSettings({ pseudocode: { enabled } });
    return lenses
      .map((lens) => lens.command?.title)
      .filter((title): title is string => title !== undefined && title.startsWith("≡ "))
      .map((title) => title.replace(/^≡ /, ""));
  }

  /** Evaluate the document unguarded (its bang forms and trailing calls), returning the results. */
  run(options: UnguardedRunOptions = {}): Promise<GuardedEvaluationResult> {
    return evaluateUnguarded(
      {
        source: this.analyzer.evaluationSource(this.uri),
        uri: this.uri,
        imports: this.analyzer.importSourceMap(this.uri),
        importPaths: this.analyzer.importPathMap(this.uri),
        wrapBareExpression: false,
      },
      options,
    );
  }
}

/** Wrap a string of MeTTa in a queryable document handle. */
export function metta(source: string, uri?: string): MettaDoc {
  return MettaDoc.of(source, uri);
}

// One-shot convenience functions: construct a document and run a single query.
export function diagnostics(source: string): Diagnostic[] {
  return MettaDoc.of(source).diagnostics();
}
export function lint(source: string): LintFinding[] {
  return MettaDoc.of(source).lint();
}
export function search(source: string, pattern: string): StructuralMatch[] {
  return structuralSearch(source, pattern);
}
export function replace(source: string, pattern: string, template: string): string {
  return structuralReplace(source, pattern, template).text;
}
export function format(source: string, options?: FormatOptions): string {
  return formatMetta(source, options);
}
export function hover(source: string, at: Loc): Hover | null {
  return MettaDoc.of(source).hover(at);
}
export function definition(source: string, at: Loc): Location[] {
  return MettaDoc.of(source).definition(at);
}
export function references(source: string, at: Loc, includeDeclaration?: boolean): Location[] {
  return MettaDoc.of(source).references(at, includeDeclaration);
}
export function symbols(source: string): DocumentSymbol[] {
  return MettaDoc.of(source).symbols();
}
export function completions(source: string, at: Loc): CompletionItem[] {
  return MettaDoc.of(source).completions(at);
}
export function codeActions(source: string, at: Loc | Range): CodeAction[] {
  return MettaDoc.of(source).codeActions(at);
}
export function explain(
  source: string,
  at: Loc,
): { readonly text: string; readonly kind: string } | null {
  return MettaDoc.of(source).explain(at);
}
export function pseudocode(source: string): string[] {
  return MettaDoc.of(source).pseudocode();
}
export function run(
  source: string,
  options?: UnguardedRunOptions,
): Promise<GuardedEvaluationResult> {
  return MettaDoc.of(source).run(options);
}
