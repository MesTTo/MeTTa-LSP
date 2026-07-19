import type {
  CodeAction,
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  FoldingRange,
  InlayHint,
  Location,
  Position,
  Range,
  SemanticTokens,
  SymbolInformation,
  SymbolKind,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver-types";
import type { GuardedEvaluationPolicy } from "./guardedEvaluationTypes.js";

export type NodeKind = "program" | "list" | "symbol" | "variable" | "string" | "number" | "comment";
export type DefinitionKind =
  | "function"
  | "type"
  | "space"
  | "binding"
  | "module"
  | "macro"
  | "constant"
  | "keyword"
  | "unknown";
export type CompletionOrigin =
  | "builtin"
  | "workspace"
  | "document"
  | "import"
  | "snippet"
  | "keyword";

export interface ParseDiagnostic {
  readonly range: Range;
  readonly message: string;
  readonly severity?: number;
  readonly code?: string;
}

export interface Token {
  readonly type: "open" | "close" | "symbol" | "variable" | "string" | "number" | "comment";
  readonly text: string;
  readonly range: Range;
  readonly offsetStart: number;
  readonly offsetEnd: number;
  readonly open?: "(";
  readonly close?: ")";
}

export interface AstNode {
  kind: NodeKind;
  text: string;
  range: Range;
  offsetStart: number;
  offsetEnd: number;
  children: AstNode[];
  parent?: AstNode;
  openToken?: Token;
  closeToken?: Token;
}

export interface ParseResult {
  readonly uri: string;
  readonly text: string;
  readonly version: number | null;
  readonly root: AstNode;
  readonly tokens: readonly Token[];
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly lineOffsets: readonly number[];
  // For each top-level form, keyed by its start offset: whether it is banged (`!`). Lets the analyzer tell a
  // run query `!(import! …)` from inert data `(import! …)`.
  readonly topLevelBangs: ReadonlyMap<number, boolean>;
}

export interface TypeSignature {
  readonly name: string;
  readonly params: readonly string[];
  readonly returns: string;
  readonly raw: string;
  readonly range: Range;
  readonly nameRange: Range;
  readonly uri: string;
}

export interface DefinitionRecord {
  readonly name: string;
  readonly kind: DefinitionKind;
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly containerRange?: Range;
  readonly bodyRange?: Range;
  readonly arity?: number;
  readonly signature?: TypeSignature;
  readonly documentation?: string;
  readonly detail?: string;
  readonly patternKey?: string;
  readonly deprecated?: boolean;
  readonly builtin?: boolean;
  readonly source?: string;
  readonly exported?: boolean;
}

export interface ReferenceRecord {
  readonly name: string;
  readonly uri: string;
  readonly range: Range;
  readonly kind:
    | DefinitionKind
    | "reference"
    | "call"
    | "type-reference"
    | "space-reference"
    | "variable-reference"
    | "keyword-reference";
  readonly enclosingDefinition?: string;
}

export interface ImportRecord {
  readonly uri: string;
  readonly range: Range;
  readonly pathRange: Range;
  readonly rawPath: string;
  readonly lineText: string;
  readonly resolvedUri?: string;
  readonly exists: boolean;
  readonly targetSpace?: string;
  readonly targetSpaceRange?: Range;
  // The path was written as a string literal. MeTTa imports now resolve quoted file paths; Prolog diagnostics
  // still use this bit to distinguish `.pl` bridge files from core modules.
  readonly quoted: boolean;
  // A top-level (import! …) runs only when banged with a leading !. A bare one is inert data whose symbols
  // never load at runtime; false flags that.
  readonly banged: boolean;
  // Nested imports are deferred until their enclosing expression runs. Only a direct top-level import can
  // make its target token available to later top-level forms during static analysis.
  readonly topLevel: boolean;
}

export interface FunctionCallInfo {
  readonly uri: string;
  readonly node: AstNode;
  readonly name: string;
  readonly nameRange: Range;
  readonly args: readonly AstNode[];
  readonly enclosingDefinition?: string;
}

export interface ActiveCallInfo {
  readonly call: FunctionCallInfo;
  readonly activeParameter: number;
}

export interface LocalBindingRecord {
  readonly name: string;
  readonly uri: string;
  readonly range: Range;
  readonly scopeRange: Range;
  readonly kind: "parameter" | "let" | "match" | "case" | "lambda" | "unknown";
}

export interface DocumentIndex {
  readonly uri: string;
  readonly text: string;
  readonly version: number | null;
  readonly parsed: ParseResult;
  readonly definitions: readonly DefinitionRecord[];
  readonly references: readonly ReferenceRecord[];
  readonly imports: readonly ImportRecord[];
  readonly signatures: readonly TypeSignature[];
  readonly spaces: readonly DefinitionRecord[];
  readonly calls: readonly FunctionCallInfo[];
  readonly locals: readonly LocalBindingRecord[];
  readonly commentsByLine: ReadonlyMap<number, string>;
}

export interface DiagnosticSettings {
  readonly syntax: boolean;
  readonly duplicateDefinitions: boolean;
  readonly duplicateDefinitionsMode: "local" | "global";
  readonly undefinedFunctions: boolean;
  readonly undefinedTypes: boolean;
  readonly undefinedVariables: boolean;
  readonly unboundSpaces: boolean;
  readonly arity: boolean;
  readonly typeMismatch: boolean;
  readonly importResolution: boolean;
  readonly lint: boolean;
  // Static Prolog interop diagnostics for referenced `.pl` files. The analyzer does not evaluate MeTTa or
  // consult Prolog; a host provider may parse Prolog source when one is attached.
  readonly prolog: boolean;
  // Interpreter-backed semantic lint. Off by default: it runs the evaluator, so it is opt-in for the editor
  // (the CLI runs it on demand regardless).
  readonly semanticLint: boolean;
  // Cross-language host bridge diagnostics: literal call args and `(: name ..)` declarations checked against
  // the TypeScript host signature. Inert unless a host bridge is attached.
  readonly bridge: boolean;
}

export interface HoverSettings {
  readonly userDefinitionComments: boolean;
}

export interface CompletionSettings {
  readonly autoImports: boolean;
  readonly includeSnippets: boolean;
}

export interface WorkspaceSettings {
  readonly maxFiles: number;
  readonly exclude: readonly string[];
}

// Editor-side formatter defaults. A project's lint.metta overrides these per the config precedence, and
// per-form rules (block/align) live only in lint.metta, not in editor settings.
export interface FormatSettings {
  readonly width: number;
  readonly indent: number;
}

export type RuntimeGuardSettings = GuardedEvaluationPolicy;

export interface RuntimeSettings {
  readonly engine: "metta-ts-core" | "metta-ts-node" | "off";
  readonly mettaTsCli: string;
  readonly nodePath: string;
  readonly allowSideEffects: boolean;
  readonly guard: RuntimeGuardSettings;
}

export interface PrologSettings {
  readonly executable: string;
  readonly timeoutMs: number;
}

// The unguarded "Run" surfaces (play button, code lens). Unlike the guard, these caps are not clamped: 0
// means effectively unlimited and lets MeTTa's own pragma! govern; a positive value is an explicit budget.
export interface RunSettings {
  readonly fuel: number;
  readonly timeoutMs: number;
}

// Where the docs site is deployed. Hover "Open docs" links and diagnostic codeDescriptions resolve
// against this base; an empty base turns docs links off.
export interface DocsSettings {
  readonly baseUrl: string;
}

// Editor overlays a user can toggle without opening settings (the quick-pick surface). Inlay hints show
// parameter names and return types inline; pseudocode shows each top-level form's mixfix reading above it.
export interface InlayHintSettings {
  readonly enabled: boolean;
}

// Pseudocode mode: a code lens above each top-level form rendering it in mixfix notation, so a reader
// sees the evaluated meaning line by line. Off by default; it is an explanatory overlay, not analysis.
export interface PseudocodeSettings {
  readonly enabled: boolean;
}

export interface ServerSettings {
  readonly diagnostics: DiagnosticSettings;
  readonly hover: HoverSettings;
  readonly completion: CompletionSettings;
  readonly workspace: WorkspaceSettings;
  readonly runtime: RuntimeSettings;
  readonly prolog: PrologSettings;
  readonly run: RunSettings;
  readonly docs: DocsSettings;
  readonly inlayHints: InlayHintSettings;
  readonly pseudocode: PseudocodeSettings;
  readonly format: FormatSettings;
}

export interface BuiltinSpec {
  readonly name: string;
  readonly kind: DefinitionKind;
  readonly arity?: number | { readonly min: number; readonly max?: number };
  readonly signatures: readonly string[];
  readonly documentation: string;
  readonly insertText?: string;
  readonly detail?: string;
  readonly patternKey?: string;
  readonly deprecated?: boolean;
  readonly source?: string;
}

export interface SymbolAtPosition {
  readonly node: AstNode;
  readonly token: Token;
  readonly name: string;
  readonly kind: DefinitionKind | "variable" | "unknown";
}

export interface RenameTarget {
  readonly name: string;
  readonly range: Range;
  readonly references: readonly Location[];
  readonly kind: DefinitionKind | "variable" | "unknown";
}

export interface AnalyzerStats {
  readonly files: number;
  readonly openDocuments: number;
  readonly symbols: number;
  readonly definitions: number;
  readonly imports: number;
  readonly diagnosticsCacheEntries: number;
  readonly workspaceRoots: readonly string[];
}

export interface WorkspaceSymbolOptions {
  readonly roots?: readonly string[];
  readonly limit?: number;
}

export type CompactWorkspaceSymbolRow = readonly [
  name: string,
  kind: string | number,
  line: number,
  char: number,
];

export interface CompactWorkspaceSymbolFile {
  readonly path: string;
  readonly rows: readonly CompactWorkspaceSymbolRow[];
}

export interface CompactWorkspaceSymbols {
  readonly fields: readonly ["name", "kind", "line", "char"];
  readonly count: number;
  readonly files: readonly CompactWorkspaceSymbolFile[];
}

export type CompactLocationRow = readonly [
  line: number,
  char: number,
  endLine: number,
  endChar: number,
];

export interface CompactLocationFile {
  readonly path: string;
  readonly rows: readonly CompactLocationRow[];
}

export interface CompactLocations {
  readonly fields: readonly ["line", "char", "endLine", "endChar"];
  readonly count: number;
  readonly files: readonly CompactLocationFile[];
}

export type CompactDocumentSymbolRow = readonly [
  name: string,
  kind: string | number,
  line: number,
  char: number,
  children?: readonly CompactDocumentSymbolRow[],
];

export interface CompactDocumentSymbols {
  readonly fields: readonly ["name", "kind", "line", "char", "children"];
  readonly count: number;
  readonly rows: readonly CompactDocumentSymbolRow[];
}

export type CompactCallHierarchyRow = readonly [
  name: string,
  kind: string | number,
  line: number,
  char: number,
  detail?: string,
];

export interface CompactCallHierarchyFile {
  readonly path: string;
  readonly rows: readonly CompactCallHierarchyRow[];
}

export interface CompactCallHierarchy {
  readonly fields: readonly ["name", "kind", "line", "char", "detail"];
  readonly count: number;
  readonly files: readonly CompactCallHierarchyFile[];
}

export type CompactCallHierarchyEdgeRow = readonly [
  name: string,
  kind: string | number,
  line: number,
  char: number,
  callLine: number,
  callChar: number,
];

export interface CompactCallHierarchyEdgeFile {
  readonly path: string;
  readonly rows: readonly CompactCallHierarchyEdgeRow[];
}

export interface CompactCallHierarchyEdges {
  readonly fields: readonly ["name", "kind", "line", "char", "callLine", "callChar"];
  readonly count: number;
  readonly files: readonly CompactCallHierarchyEdgeFile[];
}

export interface ValidationResult {
  readonly diagnostics: readonly Diagnostic[];
}

export interface InferredAtomType {
  readonly name: string;
  readonly confidence: "exact" | "heuristic";
}

export interface LspToolInput {
  readonly uri?: string;
  readonly text?: string;
  readonly workspaceRoot?: string;
  readonly position?: Position;
  readonly range?: Range;
  readonly query?: string;
  readonly newName?: string;
  readonly applyCodeAction?: string;
  readonly includeDeclaration?: boolean;
  readonly evaluationPolicy?: Partial<RuntimeGuardSettings>;
  readonly wrapBareExpression?: boolean;
  readonly filePath?: string;
  readonly line?: number;
  readonly character?: number;
  readonly limit?: number;
  readonly resultFormat?: "compact" | "lsp";
}

export interface LspToolResult {
  readonly diagnostics?: readonly Diagnostic[];
  readonly hover?: unknown;
  readonly definition?: Location | Location[] | CompactLocations | null;
  readonly documentSymbols?: readonly DocumentSymbol[] | CompactDocumentSymbols;
  readonly workspaceSymbols?: readonly SymbolInformation[] | CompactWorkspaceSymbols;
  readonly references?: readonly Location[] | CompactLocations;
  readonly rename?: WorkspaceEdit | null;
  readonly formatting?: readonly TextEdit[];
  readonly organizeImports?: readonly TextEdit[];
  readonly codeActions?: readonly CodeAction[];
  readonly applied?: { readonly files: readonly string[]; readonly changed: boolean };
  readonly error?: string;
  readonly inlayHints?: readonly InlayHint[];
  readonly callHierarchy?: unknown;
  readonly semanticTokens?: SemanticTokens;
  readonly foldingRanges?: readonly FoldingRange[];
  readonly completions?: readonly CompletionItem[];
  readonly evaluation?: unknown;
}

export function cloneRange(range: Range): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

export function rangeContainsPosition(range: Range, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) return false;
  if (position.line === range.start.line && position.character < range.start.character)
    return false;
  if (position.line === range.end.line && position.character > range.end.character) return false;
  return true;
}

export function rangeStrictlyContainsPosition(range: Range, position: Position): boolean {
  if (!rangeContainsPosition(range, position)) return false;
  const atStart =
    position.line === range.start.line && position.character === range.start.character;
  const atEnd = position.line === range.end.line && position.character === range.end.character;
  return !atStart && !atEnd;
}

export function rangeIntersects(a: Range, b: Range): boolean {
  const aStartsAfterB =
    a.start.line > b.end.line ||
    (a.start.line === b.end.line && a.start.character > b.end.character);
  const bStartsAfterA =
    b.start.line > a.end.line ||
    (b.start.line === a.end.line && b.start.character > a.end.character);
  return !aStartsAfterB && !bStartsAfterA;
}

export function comparePosition(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

export function compareRange(a: Range, b: Range): number {
  const start = comparePosition(a.start, b.start);
  if (start !== 0) return start;
  return comparePosition(a.end, b.end);
}

export function rangeLengthScore(range: Range): number {
  return (
    (range.end.line - range.start.line) * 100_000 + (range.end.character - range.start.character)
  );
}

export function toLocation(record: DefinitionRecord | ReferenceRecord): Location {
  return { uri: record.uri, range: cloneRange(record.range) };
}

export function symbolKindForDefinition(kind: DefinitionKind): SymbolKind {
  switch (kind) {
    case "function":
      return 12;
    case "type":
      return 5;
    case "space":
      return 13;
    case "binding":
      return 13;
    case "module":
      return 2;
    case "macro":
      return 6;
    case "constant":
      return 14;
    case "keyword":
      return 15;
    case "unknown":
      return 13;
    default:
      return 13;
  }
}
