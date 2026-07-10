import { FuzzyMatcher } from "@metta-ts/core";
import * as path from "pathe";
import {
  type CallHierarchyItem,
  CodeAction,
  CodeActionKind,
  type CodeLens,
  Command,
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  DocumentHighlight,
  DocumentHighlightKind,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  FoldingRangeKind,
  type Hover,
  type InlayHint,
  InlayHintKind,
  InsertTextFormat,
  Location,
  MarkupKind,
  ParameterInformation,
  type Position,
  type Range,
  SelectionRange,
  type SemanticTokens,
  type SignatureHelp,
  SignatureInformation,
  SymbolInformation,
  TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-types";
import { renderMettaDoc } from "../docs/mettaDoc.js";
import { type FormatOptions, formatMetta } from "../formatter/formatMetta.js";
import {
  type AtomspaceEpoch,
  buildSuppressions,
  CoreRuntime,
  coreBuiltinTypes,
  createWorkspaceExcludeMatcher,
  pathToUri as defaultPathToUri,
  uriToPath as defaultUriToPath,
  type FileId,
  FileRegistry,
  IncrementalDb,
  inlineSuppression,
  isMettaFile,
  type LintFinding,
  type LintOptions,
  type LintSeverity,
  lintDocument,
  lintDocumentTracked,
  normalizeUri,
  parseRules,
  patternSuppressionSpans,
  type Query,
  type RuleIssue,
  RuntimeCache,
  runSemanticLint,
  type SemanticViolation,
  type SuppressRule,
  type SyntaxEpoch,
  type TypeCheckError,
  toMixfix,
} from "../language-service/index.js";
import { classifyGroundedSite } from "./bridge/groundedSite.js";
import { hostBindingHoverLines } from "./bridge/hostBindingView.js";
import type { HostBinding, HostBridge, HostParam } from "./bridge/hostBridge.js";
import {
  BUILTIN_MODULE_NAMES,
  builtinModuleSymbols,
  moduleExportingSymbol,
} from "./builtinModules.js";
import {
  allBuiltinDefinitions,
  BUILTIN_BY_NAME,
  BUILTINS,
  builtinDefinition,
  builtinToDefinition,
  isBuiltin,
  isKeyword,
  METTA_ARITHMETIC_OPERATORS,
  METTA_ASSERTION_FORMS,
  METTA_BINDING_FORMS,
  METTA_COLLECTION_FUNCTIONS,
  METTA_COMPARISON_OPERATORS,
  METTA_CONTROL_FLOW_FORMS,
  METTA_EFFECT_FORMS,
  METTA_EVALUATION_FORMS,
  METTA_LOGICAL_OPERATORS,
  METTA_MATH_FUNCTIONS,
  METTA_MODULE_FORMS,
  METTA_PATTERN_FORMS,
  METTA_PREDICATE_FUNCTIONS,
  METTA_QUOTE_FORMS,
  METTA_TYPE_FORMS,
  OPERATORS,
  SPECIAL_FORMS,
  STANDARD_TYPES,
  signatureFromCoreType,
  stdlibDocumentText,
} from "./builtins.js";
import { ConfigLoader } from "./configLoader.js";
import { builtinDocsUrl, diagnosticDocsUrl } from "./docsLinks.js";
import type { FileProvider } from "./fileProvider.js";
import { DEFAULT_GUARDED_EVALUATION_POLICY } from "./guardedEvaluationTypes.js";
import { codeActionTitle, diagnosticMessage } from "./messages.js";
import {
  computeLineOffsets,
  findNodeAtPosition,
  findTokenAtPosition,
  fullRangeForText,
  headSymbol,
  lineText,
  nodeTextWithoutQuotes,
  offsetAt,
  parseMeTTa,
  rangeFromOffsets,
  semanticChildren,
  walkAst,
} from "./parser.js";
import type { PrologDiagnosticProvider, PrologSourceDiagnostic } from "./prologDiagnostics.js";
import { EVALUATION_CONTEXT_HEADS, isRunnableHead, wrapBareExpression } from "./runnableForms.js";
import { SemanticTokensBuilder } from "./semanticTokensBuilder.js";
import {
  type ActiveCallInfo,
  type AnalyzerStats,
  type AstNode,
  type CompletionSettings,
  cloneRange,
  comparePosition,
  compareRange,
  type DefinitionKind,
  type DefinitionRecord,
  type DiagnosticSettings,
  type DocumentIndex,
  type FunctionCallInfo,
  type HoverSettings,
  type ImportRecord,
  type InferredAtomType,
  type LocalBindingRecord,
  type ReferenceRecord,
  type RenameTarget,
  rangeContainsPosition,
  rangeIntersects,
  rangeLengthScore,
  type ServerSettings,
  type SymbolAtPosition,
  symbolKindForDefinition,
  type Token,
  type TypeSignature,
  type WorkspaceSymbolOptions,
} from "./types.js";

export const DEFAULT_SETTINGS: ServerSettings = {
  diagnostics: {
    syntax: true,
    duplicateDefinitions: true,
    duplicateDefinitionsMode: "local",
    undefinedFunctions: true,
    undefinedTypes: true,
    undefinedVariables: false,
    unboundSpaces: true,
    arity: true,
    typeMismatch: true,
    importResolution: true,
    lint: true,
    prolog: true,
    semanticLint: false,
    bridge: true,
  },
  hover: { userDefinitionComments: true },
  completion: { autoImports: true, includeSnippets: true },
  workspace: {
    maxFiles: 4000,
    exclude: ["node_modules", ".git", "dist", "out", ".venv", "__pycache__", ".metta-lsp-cache"],
  },
  runtime: {
    engine: "metta-ts-core",
    mettaTsCli: "metta-ts",
    nodePath: "node",
    allowSideEffects: true,
    guard: DEFAULT_GUARDED_EVALUATION_POLICY,
  },
  prolog: { executable: "swipl", timeoutMs: 5_000 },
  run: { fuel: 0, timeoutMs: 0 },
  docs: { baseUrl: "" },
  inlayHints: { enabled: true },
  pseudocode: { enabled: false },
  format: { width: 80, indent: 2 },
};

export type SemanticLintMode = "sync" | "cached";
export type PrologDiagnosticsMode = "sync" | "cached";

export interface SemanticLintInput {
  readonly uri: string;
  readonly version: number | null;
  readonly sourceFingerprint: string;
  readonly text: string;
  readonly severities: Readonly<Record<string, LintSeverity>>;
  readonly severityKey: string;
}

interface CachedSemanticLintDiagnostics {
  readonly version: number | null;
  readonly sourceFingerprint: string;
  readonly severityKey: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface PrologFileReference {
  readonly rawPath: string;
  readonly filePath: string;
  readonly uri: string;
  readonly range: Range;
}

interface PrologReferenceResolutionIssue {
  readonly rawPath: string;
  readonly range: Range;
}

export interface PrologDiagnosticsInput {
  readonly uri: string;
  readonly version: number | null;
  readonly references: readonly PrologFileReference[];
  readonly referenceKey: string;
  readonly settingsKey: string;
}

interface CachedPrologDiagnostics {
  readonly version: number | null;
  readonly referenceKey: string;
  readonly settingsKey: string;
  readonly diagnostics: readonly Diagnostic[];
}

function semanticLintSeverityKey(severities: Readonly<Record<string, LintSeverity>>): string {
  return Object.keys(severities)
    .sort()
    .map((key) => `${key}:${severities[key]}`)
    .join("|");
}

function semanticLintSourceFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `${text.length}:${hash >>> 0}`;
}

function prologSettingsKey(settings: ServerSettings["prolog"]): string {
  return `${settings.executable}\0${settings.timeoutMs}`;
}

function prologReferencesKey(references: readonly PrologFileReference[]): string {
  return references
    .map((ref) => `${ref.rawPath}\0${ref.filePath}\0${rangeKey(ref.range)}`)
    .join("\u0001");
}

function cloneDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return { ...diagnostic, range: cloneRange(diagnostic.range) };
}

export const SEMANTIC_TOKEN_TYPES = [
  "function",
  "macro",
  "type",
  "variable",
  "parameter",
  "property",
  "string",
  "number",
  "keyword",
  "operator",
  "comment",
  "mettaControlFlow",
  "mettaBinding",
  "mettaPattern",
  "mettaModule",
  "mettaTypeOperator",
  "mettaEvaluation",
  "mettaQuote",
  "mettaEffect",
  "mettaArithmeticOperator",
  "mettaComparisonOperator",
  "mettaLogicalOperator",
  "mettaMathFunction",
  "mettaCollectionFunction",
  "mettaPredicateFunction",
  "mettaAssertion",
] as const;
export const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "defaultLibrary",
  "returnType",
  "undefined",
  "deprecated",
] as const;

const SEMANTIC_TOKEN_TYPE_INDEX = new Map<string, number>(
  SEMANTIC_TOKEN_TYPES.map((type, index) => [type, index]),
);
const SEMANTIC_TOKEN_MODIFIER_INDEX = new Map<string, number>(
  SEMANTIC_TOKEN_MODIFIERS.map((modifier, index) => [modifier, index]),
);

const ARG_LABELS = ["$x", "$y", "$z", "$a", "$b", "$c", "$space", "$pattern", "$template"];

function rangeKey(range: Range): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}

function locationKey(location: Location): string {
  return `${normalizeUri(location.uri)}:${rangeKey(location.range)}`;
}

// A diagnostic a suppression silenced, paired with the reason it was silenced (which directive or rule), so
// the transparency surfaces can show what is being hidden and why.
export interface SuppressedDiagnostic {
  readonly diagnostic: Diagnostic;
  readonly reason: string;
}

// A diagnostic's message as plain text, whether it is stored as a string or as MarkupContent.
function diagnosticText(message: Diagnostic["message"]): string {
  return typeof message === "string" ? message : message.value;
}

// Rewrite the module-name segment of an import path when its file is renamed: replace the last segment's stem
// (oldBase) with newBase, keeping any path prefix (a `/` or `:` separator) and .metta extension.
// Returns null when the segment is not the renamed module — e.g. a directory import that resolved through
// main.metta — so those imports are left untouched.
function rewriteImportName(rawPath: string, oldBase: string, newBase: string): string | null {
  const separator = Math.max(rawPath.lastIndexOf("/"), rawPath.lastIndexOf(":"));
  const prefix = separator >= 0 ? rawPath.slice(0, separator + 1) : "";
  const segment = separator >= 0 ? rawPath.slice(separator + 1) : rawPath;
  const ext = /\.metta$/i.exec(segment)?.[0] ?? "";
  const stem = ext.length > 0 ? segment.slice(0, -ext.length) : segment;
  if (stem.toLowerCase() !== oldBase.toLowerCase()) return null;
  return `${prefix}${newBase}${ext}`;
}

// A lint finding becomes a diagnostic in the "metta-lint" source, coded by rule id; deny is an error and
// everything softer a warning (allow/off findings are already filtered out by the linter).
function lintFindingToDiagnostic(finding: LintFinding, offsets: readonly number[]): Diagnostic {
  return {
    range: rangeFromOffsets(finding.start, finding.end, offsets),
    message: finding.message,
    severity: finding.severity === "deny" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    source: "metta-lint",
    code: finding.ruleId,
  };
}

// A lint.metta's own schema error — a rule missing its (pattern …) or (message …), an unknown severity, a
// malformed constraint — becomes a diagnostic on the rule file itself, so a rule that fails to parse is
// reported instead of silently doing nothing.
function ruleIssueToDiagnostic(issue: RuleIssue, offsets: readonly number[]): Diagnostic {
  return {
    range: rangeFromOffsets(issue.start, issue.end, offsets),
    message: issue.message,
    severity: DiagnosticSeverity.Warning,
    source: "metta-lint",
    code: "lint.ruleSchema",
  };
}

// Hover text for the lint.metta DSL vocabulary, so writing a rule is as guided as reading the code it matches.
const LINT_DSL_HOVER: ReadonlyMap<string, string> = new Map([
  [
    "lint-rule",
    '**lint-rule** — declare a structural lint rule.\n\n```metta\n(lint-rule <id> (pattern …) (message …) [(severity …)] [(fix …)] [(metavariable-regex $X "…")])\n```\n\nThe pattern is matched over code as data; each match reports the message.',
  ],
  [
    "lint-severity",
    "**lint-severity** — turn a built-in rule on or off, or change how loud it is.\n\n```metta\n(lint-severity <id> deny|warn|allow|off)\n```",
  ],
  [
    "pattern",
    "**pattern** — the structural pattern to match: an ordinary MeTTa term with captures. `$X` captures one subterm, `$$$` a run of arguments, `$_` anything.",
  ],
  [
    "message",
    "**message** — the diagnostic text for a match. `{$X}` interpolates a captured variable.",
  ],
  [
    "severity",
    "**severity** — how a rule reports: `deny` (error), `warn` (warning), `allow` or `off` (disabled).",
  ],
  [
    "fix",
    "**fix** — a replacement pattern offered as a code action. Captures from the pattern reappear here, so `(fix $X)` rewrites a match to just its `$X`.",
  ],
  [
    "metavariable-regex",
    '**metavariable-regex** — a rule constraint: the captured source text must match a JavaScript regular expression from the start.\n\n```metta\n(metavariable-regex $X "^[A-Z]")\n```',
  ],
  [
    "regex",
    '**regex** — short alias for `metavariable-regex`.\n\n```metta\n(regex $X ".*debug")\n```',
  ],
  [
    "not-in-file",
    "**not-in-file** — a rule constraint: fire only when the sub-pattern appears nowhere else in the file.",
  ],
  ["has", "**has** — a rule constraint: the match must contain the sub-pattern."],
  ["not-has", "**not-has** — a rule constraint: the match must not contain the sub-pattern."],
  [
    "suppress",
    "**suppress** — silence diagnostics on any form a pattern matches.\n\n```metta\n(suppress <pattern> <code>…)\n```\n\nWith no codes it silences every code. Data, matched structurally, never run.",
  ],
]);

function diagnosticSettingsKey(settings: DiagnosticSettings): string {
  return [
    settings.syntax,
    settings.duplicateDefinitions,
    settings.duplicateDefinitionsMode,
    settings.undefinedFunctions,
    settings.undefinedTypes,
    settings.undefinedVariables,
    settings.unboundSpaces,
    settings.arity,
    settings.typeMismatch,
    settings.importResolution,
    settings.prolog,
  ].join("|");
}

function definitionKey(definition: DefinitionRecord): string {
  return `${normalizeUri(definition.uri)}:${rangeKey(definition.selectionRange)}:${definition.name}`;
}

function isSymbolLike(node: AstNode | undefined): boolean {
  return (
    node?.kind === "symbol" ||
    node?.kind === "variable" ||
    node?.kind === "string" ||
    node?.kind === "number"
  );
}

function isSpaceName(name: string): boolean {
  return name.startsWith("&") && name.length > 1;
}

function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function isDefinitionHead(name: string | null): boolean {
  return name === "=" || name === ":" || name === "macro" || name === "defmacro";
}

function isImportHead(name: string | null): boolean {
  return name === "import!" || name === "include" || name === "include!";
}

function isPrologPath(rawPath: string): boolean {
  return stripQuotes(rawPath).toLowerCase().endsWith(".pl");
}

// Stable ordering for LSP locations: by uri, then by range. Extracted so the call sites do not repeat
// `a.uri.localeCompare(b.uri) || compareRange(...)`, whose leading `||` puts a number in boolean position.
function compareLocations(a: Location, b: Location): number {
  const byUri = a.uri.localeCompare(b.uri);
  return byUri !== 0 ? byUri : compareRange(a.range, b.range);
}

function lineRange(text: string, startLine: number, endLineInclusive: number): Range {
  const offsets = computeLineOffsets(text);
  const startOffset = offsets[Math.max(0, startLine)] ?? 0;
  const afterLine = Math.min(offsets.length - 1, endLineInclusive + 1);
  const endOffset = afterLine < offsets.length ? (offsets[afterLine] ?? text.length) : text.length;
  return rangeFromOffsets(startOffset, endOffset, offsets);
}

function asDiagnosticRange(range: Range): Range {
  if (range.start.line === range.end.line && range.start.character === range.end.character) {
    return {
      start: range.start,
      end: { line: range.end.line, character: range.end.character + 1 },
    };
  }
  return range;
}

function inferAtomType(node: AstNode): InferredAtomType {
  if (node.kind === "number")
    return { name: node.text.includes(".") ? "Float" : "Number", confidence: "exact" };
  if (node.kind === "string") return { name: "String", confidence: "exact" };
  if (node.kind === "variable") return { name: "Variable", confidence: "heuristic" };
  if (node.kind === "list") return { name: "Expression", confidence: "heuristic" };
  if (node.text === "True" || node.text === "False") return { name: "Bool", confidence: "exact" };
  return { name: "Atom", confidence: "heuristic" };
}

function typeCompatible(expected: string, actual: InferredAtomType): boolean {
  const normalizedExpected = expected.replaceAll(/[()]/g, "").trim();
  if (
    !normalizedExpected ||
    normalizedExpected === "Atom" ||
    normalizedExpected === "Any" ||
    normalizedExpected === "%Undefined%"
  )
    return true;
  if (normalizedExpected === actual.name) return true;
  if (
    normalizedExpected === "Number" &&
    (actual.name === "Int" || actual.name === "Integer" || actual.name === "Float")
  )
    return true;
  if (
    (normalizedExpected === "Int" || normalizedExpected === "Integer") &&
    actual.name === "Number" &&
    actual.confidence === "heuristic"
  )
    return true;
  return actual.confidence === "heuristic";
}

// The host parameter type expected at call-argument index `i`, following a trailing rest parameter for
// overflow. Undefined means the argument overflows a fixed-arity signature — an arity concern, not a type
// one — so the type check skips it.
function expectedHostParamType(params: readonly HostParam[], i: number): string | undefined {
  const direct = params[i];
  if (direct) return direct.mettaType;
  const last = params.at(-1);
  return last?.rest === true ? last.mettaType : undefined;
}

// Whether two MeTTa type names denote the same host type, collapsing the numeric spellings the LSP infers
// (Int/Integer/Float) to Number, the only numeric type the host table produces.
function sameHostType(a: string, b: string): boolean {
  const numeric = new Set(["Number", "Int", "Integer", "Float"]);
  const canon = (type: string): string => (numeric.has(type) ? "Number" : type);
  return canon(a) === canon(b);
}

// Host types that accept any MeTTa value, so no disagreement can be asserted against them.
function hostTypeAcceptsAny(type: string): boolean {
  return type === "%Undefined%" || type === "Atom";
}

// Literal call arguments checked against a host operation's parameter types. Only exact-confidence literals
// (numbers, strings, booleans) can conflict; variables and nested expressions defer to `typeCompatible`,
// which treats them as compatible.
function checkHostCallArgs(node: AstNode, binding: HostBinding, out: Diagnostic[]): void {
  const params = binding.signature.params;
  node.children.slice(1).forEach((arg, i) => {
    const expected = expectedHostParamType(params, i);
    if (expected === undefined) return;
    const inferred = inferAtomType(arg);
    if (typeCompatible(expected, inferred)) return;
    out.push({
      range: cloneRange(arg.range),
      severity: DiagnosticSeverity.Warning,
      code: "host-arg-type",
      source: "metta-bridge",
      message: diagnosticMessage.hostArgumentType(binding.name, expected, i + 1, inferred.name),
    });
  });
}

// A MeTTa `(-> ...)` type declaration cross-checked against the resolved host signature: a warning where a
// declared parameter or the return type disagrees with the host's (skipping host positions typed
// `%Undefined%`/`Atom`, which the host could not resolve).
function crossCheckHostDeclaration(arrow: AstNode, binding: HostBinding, out: Diagnostic[]): void {
  if (arrow.kind !== "list" || arrow.children[0]?.text !== "->") return;
  const types = arrow.children.slice(1);
  const declaredReturn = types.at(-1);
  if (!declaredReturn) return;
  const declaredParams = types.slice(0, -1);
  binding.signature.params.forEach((param, i) => {
    const declared = declaredParams[i];
    if (
      !declared ||
      hostTypeAcceptsAny(param.mettaType) ||
      sameHostType(declared.text, param.mettaType)
    )
      return;
    out.push({
      range: cloneRange(declared.range),
      severity: DiagnosticSeverity.Warning,
      code: "host-decl-mismatch",
      source: "metta-bridge",
      message: diagnosticMessage.hostDeclaredArgument(i + 1, declared.text, param.mettaType),
    });
  });
  const hostReturn = binding.signature.returnMettaType;
  if (!hostTypeAcceptsAny(hostReturn) && !sameHostType(declaredReturn.text, hostReturn))
    out.push({
      range: cloneRange(declaredReturn.range),
      severity: DiagnosticSeverity.Warning,
      code: "host-decl-mismatch",
      source: "metta-bridge",
      message: diagnosticMessage.hostDeclaredReturn(declaredReturn.text, hostReturn),
    });
}

function markdownCode(language: string, code: string): string {
  return `\n\n\`\`\`${language}\n${code}\n\`\`\``;
}

function relativeDisplayPath(uri: string, roots: readonly string[]): string {
  const filePath = defaultUriToPath(uri);
  if (!filePath) return uri;
  for (const rootUri of roots) {
    const rootPath = defaultUriToPath(rootUri) ?? rootUri;
    if (filePath.startsWith(rootPath))
      return path.relative(rootPath, filePath) || path.basename(filePath);
  }
  return filePath;
}

function collectVariables(node: AstNode, out: AstNode[] = []): AstNode[] {
  if (node.kind === "variable") out.push(node);
  for (const child of node.children) collectVariables(child, out);
  return out;
}

function fullLineText(text: string, line: number): string {
  return lineText(text, line);
}

function lineHasSingleImportForm(text: string): boolean {
  const parsed = parseMeTTa("metta://organize-imports-line", text);
  const children = semanticChildren(parsed.root);
  if (children.length === 0 || children.length > 2) return false;
  const hasBang = children[0]?.kind === "symbol" && children[0].text === "!";
  const form = hasBang ? children[1] : children[0];
  if (form === undefined || form.kind !== "list") return false;
  return isImportHead(headSymbol(form));
}

function namedChildText(node: AstNode | undefined): string | null {
  if (!node) return null;
  if (node.kind === "symbol" || node.kind === "variable") return node.text;
  if (node.kind === "string") return nodeTextWithoutQuotes(node);
  return null;
}

// PeTTa's (library <name>) module reference resolves by the bare library name from the module search path.
// Returns <name>, or null when the node is not that form.
function libraryRefName(node: AstNode): string | null {
  if (node.kind !== "list") return null;
  const children = semanticChildren(node);
  if (children.length !== 2 || namedChildText(children[0]) !== "library") return null;
  return namedChildText(children[1]);
}

function prologSourceRange(diagnostic: PrologSourceDiagnostic): Range {
  return {
    start: { line: diagnostic.line, character: diagnostic.character },
    end: { line: diagnostic.line, character: diagnostic.character + 1 },
  };
}

function prologProviderFailure(error: unknown): PrologSourceDiagnostic {
  return {
    line: 0,
    character: 0,
    severity: DiagnosticSeverity.Warning,
    code: "prolog.backend",
    message: `SWI-Prolog diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function makeSignature(
  name: string,
  typeNode: AstNode | undefined,
  nameRange: Range,
  uri: string,
): TypeSignature | undefined {
  if (!typeNode) return undefined;
  const children = typeNode.kind === "list" ? semanticChildren(typeNode) : [];
  if (children.length > 0 && namedChildText(children[0]) === "->") {
    const params = children.slice(1, -1).map((child) => child.text.trim());
    const returns = children[children.length - 1]?.text.trim() ?? "Atom";
    return {
      name,
      params,
      returns,
      raw: typeNode.text.trim(),
      range: typeNode.range,
      nameRange,
      uri,
    };
  }
  return {
    name,
    params: [],
    returns: typeNode.text.trim(),
    raw: typeNode.text.trim(),
    range: typeNode.range,
    nameRange,
    uri,
  };
}

function commentText(raw: string): string {
  return raw.replace(/^;+\s?/, "").trimEnd();
}

function isDocComment(raw: string): boolean {
  return /^;;\s?/.test(raw) || /^;+\s*@(?:doc|desc|param|return)\b/.test(raw);
}

function commentsBefore(node: AstNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  const siblings = parent.children;
  const index = siblings.indexOf(node);
  if (index <= 0) return undefined;
  const lines: string[] = [];
  let expectedLine = node.range.start.line - 1;
  for (let i = index - 1; i >= 0; i--) {
    const sibling = siblings[i];
    if (!sibling) continue;
    if (sibling.kind !== "comment") break;
    if (sibling.range.start.line > expectedLine) continue;
    // Only the block directly above the definition is its doc; a blank line ends it, so a distant file header
    // is not swallowed into every symbol's hover.
    if (sibling.range.start.line < expectedLine) break;
    if (!isDocComment(sibling.text)) break;
    lines.unshift(commentText(sibling.text));
    expectedLine = sibling.range.start.line - 1;
  }
  const joined = lines.join("\n").trim();
  return joined.length > 0 ? joined : undefined;
}

function callLabel(name: string, arity: number): string {
  const args = Array.from(
    { length: arity },
    (_, index) => ARG_LABELS[index] ?? `$arg${index + 1}`,
  ).join(" ");
  return args ? `(${name} ${args})` : `(${name})`;
}

// The outline icon for a grouped symbol. A bare `(: name ...)` signature is recorded as a "type"; when the
// symbol also has an implementation (a `=` clause, macro, binding, ...) that implementation kind wins, so a
// signatured function shows a function icon rather than a type icon.
function representativeKind(defs: readonly DefinitionRecord[]): DefinitionKind {
  return defs.find((def) => def.kind !== "type")?.kind ?? defs[0]?.kind ?? "unknown";
}

// The smallest range covering every definition in a group, so the grouped outline entry spans its signature
// and all its clauses. Definitions never nest at the top level, but the max end is computed by comparison to
// stay correct regardless of source order.
function unionDefinitionRange(defs: readonly DefinitionRecord[]): Range {
  let { start, end } = defs[0]?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
  for (const def of defs) {
    if (comparePosition(def.range.start, start) < 0) start = def.range.start;
    if (comparePosition(def.range.end, end) > 0) end = def.range.end;
  }
  return {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  };
}

// The DB input key holding a file's parsed index (or null when it is not indexed).
function indexInputKey(id: FileId): string {
  return `index:${id}`;
}

// Element-wise equality of two FileId lists — the `eq` that gives the imports and closure queries their
// early cutoff.
function fileIdsEqual(a: readonly FileId[], b: readonly FileId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface DiagnosticsArg {
  readonly id: FileId;
  readonly settingsKey: string;
  readonly settings: DiagnosticSettings;
}

export class Analyzer {
  private readonly documents = new Map<string, DocumentIndex>();
  private readonly openDocuments = new Set<string>();
  private readonly workspaceRoots = new Set<string>();
  private readonly moduleRoots = new Set<string>();
  private readonly definitionsByName = new Map<string, DefinitionRecord[]>();
  private readonly referencesByName = new Map<string, ReferenceRecord[]>();
  private readonly fileSnapshots = new Map<
    string,
    { readonly mtimeMs: number; readonly size: number }
  >();
  // The version-gated engine (§3): file identity is interned to a FileId; the red-green memo DB holds the
  // cross-file caches (import closure, diagnostics) keyed by those ids, so an edit invalidates only the
  // memos that actually depend on the edited file rather than clearing every cache. Its revision is the
  // syntax epoch.
  private readonly registry = new FileRegistry();
  private readonly db = new IncrementalDb();
  // Runtime answers (get-type/get-doc from the live interpreter) are stamped with BOTH epochs and kept out
  // of the pure DB. The RuntimeProvider that populates this is wired in a later step; the epoch mechanism it
  // plugs into lives here so the two-epoch model is complete now.
  private readonly runtimeCache = new RuntimeCache<string>();
  private settings: ServerSettings = DEFAULT_SETTINGS;
  // The atomspace epoch: advanced by space mutations, never an input to the pure DB, so evaluating can never
  // invalidate a static memo and editing can never invalidate a runtime answer through this dimension.
  private atomspaceEpochValue = 0;
  // How many times the cross-file diagnostic pass has actually executed. Stays flat when an edit touches a
  // file outside a document's import closure — the observable proof that invalidation is fine-grained.
  private diagnosticsComputations = 0;
  private semanticLintMode: SemanticLintMode = "sync";
  private readonly semanticLintCache = new Map<string, CachedSemanticLintDiagnostics>();
  private prologDiagnosticsMode: PrologDiagnosticsMode = "sync";
  private readonly prologDiagnosticsCache = new Map<string, CachedPrologDiagnostics>();

  // The resolved import ids of a file, or null when the file is not indexed. `eq` gives the closure its
  // cutoff: a body/whitespace edit that leaves the import list unchanged does not re-walk any closure.
  private readonly importsQuery: Query<FileId, readonly FileId[] | null> = {
    id: "imports",
    key: (id) => String(id),
    run: (ctx, id) => {
      const index = ctx.input(indexInputKey(id)) as DocumentIndex | null;
      if (index === null) return null;
      const ids: FileId[] = [];
      for (const imp of index.imports) {
        if (imp.resolvedUri === undefined) continue;
        const resolvedPath = this.uriToPath(imp.resolvedUri);
        if (resolvedPath !== null && !isMettaFile(resolvedPath)) continue;
        ids.push(this.registry.idFor(imp.resolvedUri));
      }
      return ids;
    },
    eq: (a, b) => (a === null || b === null ? a === b : fileIdsEqual(a, b)),
  };

  // The transitive import closure of a file (the source itself is always included), derived purely from the
  // published import lists. Reading each importsQuery records a dependency edge, so the closure is re-walked
  // exactly when some reachable file's imports change — pyright's importedBy propagation, obtained for free
  // from the recorded reverse edges.
  private readonly visibleClosureQuery: Query<FileId, readonly FileId[]> = {
    id: "visibleClosure",
    key: (id) => String(id),
    run: (ctx, rootId) => {
      const visible = new Set<FileId>([rootId]);
      const queue: FileId[] = [rootId];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) continue;
        const imports = ctx.query(this.importsQuery, current);
        if (imports === null) continue;
        for (const importId of imports) {
          if (visible.has(importId)) continue;
          // An import that failed to load is not part of the closure (matches the lazy-index skip).
          if (ctx.query(this.importsQuery, importId) === null) continue;
          visible.add(importId);
          queue.push(importId);
        }
      }
      return [...visible].sort((a, b) => a - b);
    },
    eq: fileIdsEqual,
  };

  // A file's diagnostics. Reads its own index, its visible closure, and the index of every visible file, so
  // it re-runs exactly when one of those changes and stays cached when an unrelated file is edited.
  private readonly diagnosticsQuery: Query<DiagnosticsArg, Diagnostic[]> = {
    id: "diagnostics",
    key: (arg) => `${arg.id} ${arg.settingsKey}`,
    run: (ctx, arg) => {
      const ownIndex = ctx.input(indexInputKey(arg.id)) as DocumentIndex | null;
      if (ownIndex === null) return [];
      const closure = ctx.query(this.visibleClosureQuery, arg.id);
      const closureUris = new Set<string>();
      for (const fileId of closure) {
        ctx.input(indexInputKey(fileId));
        const uri = this.registry.uriFor(fileId);
        if (uri !== undefined) closureUris.add(uri);
      }
      return this.computeDiagnostics(ownIndex, closureUris, arg.settings);
    },
  };

  // The declaration-only source of each file's visible closure, cached per syntax epoch so it is assembled
  // once per edit rather than on every hover. Feeds the live get-type/get-doc queries.
  private readonly contextCache = new Map<string, { syntaxEpoch: number; context: string }>();

  // The interpreter is injected (§2.9): the node/browser adapters pass a live CoreRuntime; it is pure
  // (@metta-ts/core only), so the default is a real one and tests can substitute a fake.
  private readonly configLoader: ConfigLoader;

  public constructor(
    private readonly files: FileProvider,
    private readonly runtime: CoreRuntime = new CoreRuntime(),
    // The cross-language host bridge, injected by the node host (absent on the browser host or when no
    // TypeScript project is present); the analyzer stays browser-safe by depending only on its interface.
    private bridge?: HostBridge,
    private prologDiagnostics?: PrologDiagnosticProvider,
  ) {
    this.configLoader = new ConfigLoader(files);
  }

  // Attach (or clear) the host bridge after construction. The LSP builds it once the workspace root is known
  // from `initialize`, which is after the analyzer itself exists.
  public setHostBridge(bridge: HostBridge | undefined): void {
    this.bridge = bridge;
  }

  public setPrologDiagnosticProvider(provider: PrologDiagnosticProvider | undefined): void {
    this.prologDiagnostics = provider;
    this.prologDiagnosticsCache.clear();
  }

  // The TypeScript host binding a MeTTa reference resolves to, or undefined. A `(js-atom "path")` string
  // probes a JS global; a plain symbol looks up a registered grounded operation. Only string and symbol
  // tokens qualify, so a string literal that is not a js-interop argument never matches an operation name.
  private hostBindingFor(
    uri: string,
    position: Position,
    symbol: SymbolAtPosition,
  ): HostBinding | undefined {
    if (this.bridge === undefined) return undefined;
    if (symbol.token.type === "string") {
      const index = this.ensureIndexed(uri);
      const site = index ? classifyGroundedSite(index.parsed.root, position) : null;
      return site?.kind === "js-atom" ? this.bridge.probeGlobal(site.path) : undefined;
    }
    if (symbol.token.type !== "symbol") return undefined;
    return this.bridge.lookupOperation(symbol.name);
  }

  // The host binding for the grounded atom at a position, or undefined. Public entry for the MCP host-type
  // tool: the same resolution hover and go-to-definition use.
  public hostTypeAt(uri: string, position: Position): HostBinding | undefined {
    const symbol = this.symbolAt(uri, position);
    return symbol ? this.hostBindingFor(uri, position, symbol) : undefined;
  }

  // Cross-language diagnostics: literal call arguments checked against the host parameter types, and each
  // MeTTa `(: name (-> ..))` declaration cross-checked against the resolved host signature. Both are
  // conservative — only exact literal types and concrete (non-`%Undefined%`) host types warn — so false
  // positives are near zero. A definition head like `(= (op $a $b) ..)` type-checks only its literal args,
  // and its variables defer to `typeCompatible`, so it is not falsely flagged.
  private bridgeDiagnostics(uri: string): Diagnostic[] {
    const bridge = this.bridge;
    if (!bridge) return [];
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const diagnostics: Diagnostic[] = [];
    walkAst(index.parsed.root, (node) => {
      if (node.kind !== "list") return;
      const head = node.children[0];
      if (!head || head.kind !== "symbol") return;
      if (head.text === ":") {
        const nameNode = node.children[1];
        const arrow = node.children[2];
        if (nameNode?.kind === "symbol" && arrow) {
          const binding = bridge.lookupOperation(nameNode.text);
          if (binding) crossCheckHostDeclaration(arrow, binding, diagnostics);
        }
        return;
      }
      const binding = bridge.lookupOperation(head.text);
      if (binding) checkHostCallArgs(node, binding, diagnostics);
    });
    return diagnostics;
  }

  // Prolog interop diagnostics: when a MeTTa file references a `.pl` file through the Prolog bridge, ask the
  // host provider to parse that Prolog source and anchor any SWI diagnostics on the MeTTa path literal. The
  // provider is optional and Node-only; the analyzer remains pure/browser-safe.
  private prologBridgeDiagnostics(index: DocumentIndex): Diagnostic[] {
    const provider = this.prologDiagnostics;
    if (provider === undefined) return [];
    const diagnostics: Diagnostic[] = [];
    for (const ref of this.prologFileReferences(index)) {
      let sourceDiagnostics: readonly PrologSourceDiagnostic[];
      try {
        sourceDiagnostics = provider.diagnosticsForFile(ref.filePath, this.settings.prolog);
      } catch (error) {
        sourceDiagnostics = [prologProviderFailure(error)];
      }
      diagnostics.push(...this.prologSourceDiagnosticsToDiagnostics(ref, sourceDiagnostics));
    }
    return diagnostics;
  }

  private prologFileReferences(index: DocumentIndex): PrologFileReference[] {
    return this.collectPrologFileReferences(index).references;
  }

  private collectPrologFileReferences(index: DocumentIndex): {
    references: PrologFileReference[];
    unresolved: PrologReferenceResolutionIssue[];
  } {
    const references: PrologFileReference[] = [];
    const unresolved: PrologReferenceResolutionIssue[] = [];
    const push = (
      rawPath: string,
      range: Range,
      resolvedUri: string | undefined,
      reportUnresolved: boolean,
    ): void => {
      if (!isPrologPath(rawPath)) return;
      const resolvedPath =
        resolvedUri !== undefined
          ? this.uriToPath(resolvedUri)
          : this.resolvePrologFilePath(index, rawPath);
      if (
        resolvedPath === null ||
        !isPrologPath(resolvedPath) ||
        this.files.stat(resolvedPath)?.isFile !== true
      ) {
        if (reportUnresolved) unresolved.push({ rawPath, range: cloneRange(range) });
        return;
      }
      const uri = this.pathToUri(resolvedPath);
      const key = `${resolvedPath}\0${rangeKey(range)}`;
      if (
        references.some((existing) => `${existing.filePath}\0${rangeKey(existing.range)}` === key)
      )
        return;
      references.push({ rawPath, filePath: resolvedPath, uri, range: cloneRange(range) });
    };

    for (const imp of index.imports) push(imp.rawPath, imp.pathRange, imp.resolvedUri, false);

    walkAst(index.parsed.root, (node) => {
      if (node.kind !== "list") return;
      const children = semanticChildren(node);
      const head = namedChildText(children[0]);
      if (head !== "prolog-consult" && head !== "import_prolog_functions_from_file") return;
      const pathNode = children[1];
      if (pathNode === undefined) return;
      const rawPath = libraryRefName(pathNode) ?? nodeTextWithoutQuotes(pathNode);
      push(rawPath, pathNode.range, undefined, true);
    });

    return { references, unresolved };
  }

  public prologSourceDiagnosticsToDiagnostics(
    ref: PrologFileReference,
    sourceDiagnostics: readonly PrologSourceDiagnostic[],
  ): Diagnostic[] {
    return sourceDiagnostics.map((sourceDiagnostic) => ({
      range: cloneRange(ref.range),
      severity: sourceDiagnostic.severity as DiagnosticSeverity,
      code: sourceDiagnostic.code,
      source: "metta-prolog",
      message: diagnosticMessage.prologSourceDiagnostic(
        ref.rawPath,
        sourceDiagnostic.line + 1,
        sourceDiagnostic.character + 1,
        sourceDiagnostic.message,
      ),
      relatedInformation: [
        {
          location: Location.create(ref.uri, prologSourceRange(sourceDiagnostic)),
          message: "Prolog source",
        },
      ],
    }));
  }

  private resolvePrologFilePath(index: DocumentIndex, rawPath: string): string | null {
    const stripped = stripQuotes(rawPath);
    if (stripped.length === 0) return null;
    const sourcePath = this.uriToPath(index.uri);
    const baseDir = sourcePath === null ? this.files.cwd() : path.dirname(sourcePath);
    const roots = new Set<string>([baseDir, this.files.cwd()]);
    const candidates = path.isAbsolute(stripped)
      ? [path.normalize(stripped)]
      : [...roots].map((root) => path.resolve(root, stripped));
    for (const candidate of candidates) {
      if (this.files.stat(candidate)?.isFile === true) return candidate;
    }
    return null;
  }

  // Merge the editor's format settings with the document's lint.metta, project config winning, into the
  // options the formatter reads. Per-form block/align rules come only from lint.metta.
  private formatOptionsFor(uri: string): FormatOptions {
    const editor = this.settings.format;
    const filePath = this.uriToPath(uri);
    const project = filePath === null ? undefined : this.configLoader.loadForFile(filePath).format;
    return {
      width: project?.width ?? editor.width,
      indent: project?.indent ?? editor.indent,
      headLineArgs: project?.blockForms ?? {},
      alignForms: project?.alignForms ?? [],
    };
  }

  // Drop cached lint.metta parses; call when a config file changes on disk.
  public invalidateConfig(): void {
    this.configLoader.invalidate();
    this.semanticLintCache.clear();
    this.prologDiagnosticsCache.clear();
  }

  public setSemanticLintMode(mode: SemanticLintMode): void {
    this.semanticLintMode = mode;
  }

  public setPrologDiagnosticsMode(mode: PrologDiagnosticsMode): void {
    this.prologDiagnosticsMode = mode;
  }

  // Publish a file's index (or null when it is gone/unreadable) as the DB input the pure queries read. A
  // write that does not change the index is a no-op, so a no-op document update costs nothing downstream.
  private publishIndexInput(normalizedUri: string, index: DocumentIndex | null): void {
    this.db.setInput(indexInputKey(this.registry.idFor(normalizedUri)), index);
  }

  // The declaration-only source (every non-bang top-level atom) of a file's visible closure, assembled with
  // core's own parser so bang queries are never included and thus never executed. Cached per syntax epoch.
  private declarationContext(uri: string): string {
    const normalized = normalizeUri(uri);
    const syntaxEpoch = this.db.getRevision();
    const cached = this.contextCache.get(normalized);
    if (cached && cached.syntaxEpoch === syntaxEpoch) return cached.context;
    const parts: string[] = [];
    for (const visibleUri of this.visibleUris(normalized)) {
      const index = this.documents.get(visibleUri);
      if (!index) continue;
      const builtinImportLines = new Set(
        index.imports
          .filter((imp) => imp.banged && BUILTIN_MODULE_NAMES.has(imp.rawPath))
          .map((imp) => imp.range.start.line),
      );
      for (const top of index.parsed.root.children) {
        if (top.kind === "comment") continue;
        if (top.kind === "symbol" && top.text === "!") continue;
        const source = index.text.slice(top.offsetStart, top.offsetEnd);
        // Declarations always; a bang only when it imports a built-in module, so that module's symbols are
        // in scope for get-type/get-doc without executing the file's other bang queries.
        if (index.parsed.topLevelBangs.get(top.offsetStart) !== true) parts.push(source);
        else if (builtinImportLines.has(top.range.start.line)) parts.push(`!${source}`);
      }
    }
    const context = parts.join("\n");
    this.contextCache.set(normalized, { syntaxEpoch, context });
    return context;
  }

  // The same declaration-only context hover/type introspection uses. The docs generator reads this public
  // view so generated reference pages ask the interpreter the same get-doc question the editor asks.
  public declarationContextForDocs(uri: string): string {
    return this.declarationContext(uri);
  }

  // The interpreter-exact type of `expression` in `uri`'s context, or null when it has none (ill-typed) or
  // the runtime is unavailable. Definitive answers (including "no type") are cached by both epochs.
  private liveType(uri: string, expression: string): string | null {
    const args = `${normalizeUri(uri)} ${expression}`;
    const cached = this.cachedRuntimeAnswer("get-type", args);
    if (cached !== undefined) return cached.length > 0 ? cached : null;
    const result = this.runtime.getType(this.declarationContext(uri), expression);
    if (result.isErr()) return null;
    const rendered = result.value.join(" | ");
    this.cacheRuntimeAnswer("get-type", args, rendered);
    return rendered.length > 0 ? rendered : null;
  }

  // The interpreter's documentation for `symbol` rendered as markdown, or null when it has none. Cached by
  // both epochs; the empty string is the cached "no documentation" answer.
  private liveDoc(uri: string, symbol: string): string | null {
    const args = `${normalizeUri(uri)} ${symbol}`;
    const cached = this.cachedRuntimeAnswer("get-doc", args);
    if (cached !== undefined) return cached.length > 0 ? cached : null;
    const result = this.runtime.getDoc(this.declarationContext(uri), symbol);
    if (result.isErr()) return null;
    const rendered = result.value ? renderMettaDoc(result.value) : "";
    this.cacheRuntimeAnswer("get-doc", args, rendered);
    return rendered.length > 0 ? rendered : null;
  }

  // The interpreter's own type/arity verdict per application (the grounded op `check-types`): an arity or
  // argument-type error atom, or null when well-typed or untyped. This is the sole source of the call.arity
  // and call.typeMismatch diagnostics — no TS type heuristic. All expressions are checked in ONE interpreter
  // run for the uncached ones (the declaration context is built once, not once per call), so a validate stays
  // O(context + calls). Cached by both epochs; the empty string is the cached "well-typed" answer, otherwise
  // the JSON of the structured error. Returns a verdict-by-expression map.
  private liveCheckTypes(
    uri: string,
    expressions: readonly string[],
  ): Map<string, TypeCheckError | null> {
    const verdicts = new Map<string, TypeCheckError | null>();
    const uncached: string[] = [];
    // A Set for the O(1) dedup; uncached.includes() here was O(calls^2) on a large file.
    const queued = new Set<string>();
    for (const expression of expressions) {
      if (verdicts.has(expression) || queued.has(expression)) continue;
      const cached = this.cachedRuntimeAnswer("check-types", `${normalizeUri(uri)} ${expression}`);
      if (cached !== undefined)
        verdicts.set(expression, cached.length > 0 ? (JSON.parse(cached) as TypeCheckError) : null);
      else {
        uncached.push(expression);
        queued.add(expression);
      }
    }
    if (uncached.length > 0) {
      const batch = this.runtime.checkTypesBatch(this.declarationContext(uri), uncached);
      const values = batch.isErr() ? uncached.map(() => null) : batch.value;
      uncached.forEach((expression, index) => {
        const error = values[index] ?? null;
        this.cacheRuntimeAnswer(
          "check-types",
          `${normalizeUri(uri)} ${expression}`,
          error === null ? "" : JSON.stringify(error),
        );
        verdicts.set(expression, error);
      });
    }
    return verdicts;
  }

  // The parameter counts a typed function accepts, parsed from get-type of its head (an overloaded function
  // has several). Only enriches the interpreter's count-less IncorrectNumberOfArguments with "expected N".
  private expectedArities(uri: string, name: string): number[] {
    const type = this.liveType(uri, name);
    if (type === null) return [];
    const counts = new Set<number>();
    for (const one of type.split(" | ")) {
      const params = signatureFromCoreType(name, one)?.params.length;
      if (params !== undefined) counts.add(params);
    }
    return [...counts].sort((a, b) => a - b);
  }

  // A guarded preview of what the runnable form under the cursor reduces to. The analyzer's runtime is
  // fuel-bounded and catches errors, so hovering evaluates safely (no side effects, no hang); the answer is
  // cached by both epochs. Returns null when the cursor is not on a runnable form, or the form does not
  // reduce to anything new (a value, or an error, would just echo the input).
  private evaluationPreview(index: DocumentIndex, position: Position): string | null {
    const offset = offsetAt(position, index.parsed.lineOffsets);
    const span = this.runnableFormSpans(index).find((s) => offset >= s.start && offset <= s.end);
    if (!span) return null;
    const form = index.text.slice(span.start, span.end).replace(/^!\s*/, "").trim();
    if (form.length === 0) return null;
    const args = `${index.uri} ${form}`;
    let rendered = this.cachedRuntimeAnswer("evaluate", args);
    if (rendered === undefined) {
      const result = this.runtime.evaluate(this.declarationContext(index.uri), form);
      rendered = result.isErr() ? "" : result.value.join(" | ");
      this.cacheRuntimeAnswer("evaluate", args, rendered);
    }
    if (rendered.length === 0 || rendered === form) return null;
    return `Evaluates to (guarded):${markdownCode("metta", rendered)}`;
  }

  private addToNameIndex<T extends { readonly name: string }>(
    map: Map<string, T[]>,
    records: readonly T[],
  ): void {
    for (const record of records) {
      const existing = map.get(record.name) ?? [];
      existing.push(record);
      map.set(record.name, existing);
    }
  }

  private removeDocumentFromIndexes(uri: string): void {
    const normalized = normalizeUri(uri);
    const existing = this.documents.get(normalized);
    if (!existing) return;
    for (const def of existing.definitions) {
      const next = (this.definitionsByName.get(def.name) ?? []).filter(
        (candidate) => candidate.uri !== normalized,
      );
      if (next.length > 0) this.definitionsByName.set(def.name, next);
      else this.definitionsByName.delete(def.name);
    }
    for (const ref of existing.references) {
      const next = (this.referencesByName.get(ref.name) ?? []).filter(
        (candidate) => candidate.uri !== normalized,
      );
      if (next.length > 0) this.referencesByName.set(ref.name, next);
      else this.referencesByName.delete(ref.name);
    }
  }

  private addDocumentToIndexes(index: DocumentIndex): void {
    this.addToNameIndex(this.definitionsByName, index.definitions);
    this.addToNameIndex(this.referencesByName, index.references);
  }

  public updateSettings(settings: Partial<ServerSettings>): void {
    // Diagnostic settings are part of the diagnostics query key, so a settings change is picked up by
    // querying under a new key rather than by clearing a cache.
    this.settings = mergeSettings(this.settings, settings);
  }

  public getSettings(): ServerSettings {
    return this.settings;
  }

  public setWorkspaceRoots(roots: readonly string[]): void {
    this.workspaceRoots.clear();
    for (const root of roots) this.workspaceRoots.add(normalizeUri(root));
  }

  public getWorkspaceRoots(): string[] {
    return [...this.workspaceRoots];
  }

  private uriWithinRoot(uri: string, rootUri: string): boolean {
    const normalizedUri = normalizeUri(uri);
    const normalizedRoot = normalizeUri(rootUri);
    const filePath = this.uriToPath(normalizedUri);
    const rootPath = this.uriToPath(normalizedRoot);
    if (filePath && rootPath) {
      const relative = path.relative(rootPath, filePath);
      return (
        relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
      );
    }
    const rootPrefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
    return normalizedUri === normalizedRoot || normalizedUri.startsWith(rootPrefix);
  }

  private uriWithinRoots(uri: string, roots: readonly string[]): boolean {
    if (roots.length === 0) return true;
    return roots.some((root) => this.uriWithinRoot(uri, root));
  }

  private uriToPath(uri: string): string | null {
    return this.files.uriToPath?.(uri) ?? defaultUriToPath(uri);
  }

  private pathToUri(fsPath: string): string {
    return this.files.pathToUri?.(fsPath) ?? defaultPathToUri(fsPath);
  }

  public updateDocument(
    uri: string,
    text: string,
    version: number | null = null,
    open = true,
  ): DocumentIndex {
    const normalized = normalizeUri(uri);
    if (open) this.openDocuments.add(normalized);
    const existing = this.documents.get(normalized);
    if (existing && existing.text === text && existing.version === version) {
      return existing;
    }
    return this.replaceDocumentIndex(normalized, text, version);
  }

  // File creation, deletion, and rename can change whether an unchanged import path resolves. Rebuild the
  // indexed documents after those topology changes so their ImportRecords reflect the current provider.
  public refreshImportResolutions(): void {
    const documents = [...this.documents.values()];
    for (const document of documents) {
      this.replaceDocumentIndex(document.uri, document.text, document.version);
    }
  }

  private replaceDocumentIndex(
    normalized: string,
    text: string,
    version: number | null,
  ): DocumentIndex {
    this.semanticLintCache.delete(normalized);
    this.prologDiagnosticsCache.delete(normalized);
    this.removeDocumentFromIndexes(normalized);
    const index = this.buildDocumentIndex(normalized, text, version);
    this.documents.set(normalized, index);
    this.fileSnapshots.delete(normalized);
    this.addDocumentToIndexes(index);
    this.publishIndexInput(normalized, index);
    return index;
  }

  public closeDocument(uri: string): void {
    this.openDocuments.delete(normalizeUri(uri));
  }

  public forgetDocument(uri: string): void {
    const normalized = normalizeUri(uri);
    this.openDocuments.delete(normalized);
    this.removeDocumentFromIndexes(normalized);
    this.documents.delete(normalized);
    this.semanticLintCache.delete(normalized);
    this.prologDiagnosticsCache.delete(normalized);
    this.fileSnapshots.delete(normalized);
    this.publishIndexInput(normalized, null);
  }

  // Re-index a file from disk after an external change (a watched-file event, not an editor edit). An open
  // document is left alone: the editor's own sync is authoritative for it. A file that no longer reads, or is
  // not a MeTTa file, is forgotten if it was indexed.
  public refreshFromDisk(uri: string): void {
    const normalized = normalizeUri(uri);
    if (this.openDocuments.has(normalized)) return;
    const fsPath = this.uriToPath(uri);
    const text = fsPath === null ? null : this.files.readFile(fsPath);
    if (text === null || fsPath === null || !isMettaFile(fsPath)) {
      if (this.documents.has(normalized)) this.forgetDocument(uri);
      return;
    }
    this.updateDocument(uri, text, null, false);
  }

  public ensureIndexed(
    uri: string,
    text?: string,
    version: number | null = null,
  ): DocumentIndex | null {
    const normalized = normalizeUri(uri);
    const existing = this.documents.get(normalized);
    if (text !== undefined)
      return this.updateDocument(normalized, text, version, this.openDocuments.has(normalized));
    if (this.openDocuments.has(normalized) && existing) return existing;
    const filePath = this.uriToPath(normalized);
    if (!filePath) return existing ?? null;
    const stat = this.files.stat(filePath);
    if (!stat) return existing ?? null;
    const snapshot = this.fileSnapshots.get(normalized);
    if (existing && snapshot && snapshot.mtimeMs === stat.mtimeMs && snapshot.size === stat.size)
      return existing;
    const content = this.files.readFile(filePath);
    if (content === null) return existing ?? null;
    const updated = this.updateDocument(normalized, content, version, false);
    this.fileSnapshots.set(normalized, { mtimeMs: stat.mtimeMs, size: stat.size });
    return updated;
  }

  public getDocument(uri: string): DocumentIndex | undefined {
    return this.documents.get(normalizeUri(uri));
  }

  public async scanWorkspace(): Promise<void> {
    const settings = this.settings.workspace;
    const isIgnoredPath = createWorkspaceExcludeMatcher(settings.exclude);
    let indexed = 0;
    for (const rootUri of this.workspaceRoots) {
      const rootPath = this.uriToPath(rootUri) ?? rootUri;
      if (!rootPath || !this.files.stat(rootPath)) continue;
      const stack = [rootPath];
      while (stack.length > 0 && indexed < settings.maxFiles) {
        const current = stack.pop();
        if (!current || isIgnoredPath(path.normalize(current))) continue;
        const stat = this.files.stat(current);
        if (!stat || stat.isSymbolicLink) continue;
        if (stat.isDirectory) {
          const entries = this.files.readDir(current);
          if (!entries) continue;
          for (const entry of entries) stack.push(path.join(current, entry));
          continue;
        }
        if (!stat.isFile || !isMettaFile(current)) continue;
        const uri = this.pathToUri(current);
        if (this.openDocuments.has(uri)) continue;
        const snapshot = this.fileSnapshots.get(uri);
        if (
          snapshot &&
          snapshot.mtimeMs === stat.mtimeMs &&
          snapshot.size === stat.size &&
          this.documents.has(uri)
        ) {
          indexed++;
          continue;
        }
        const content = this.files.readFile(current);
        if (content === null) continue;
        this.updateDocument(uri, content, null, false);
        this.fileSnapshots.set(uri, { mtimeMs: stat.mtimeMs, size: stat.size });
        indexed++;
      }
    }
  }

  public stats(): AnalyzerStats {
    const symbols = new Set<string>();
    let definitions = 0;
    let imports = 0;
    for (const index of this.documents.values()) {
      for (const def of index.definitions) symbols.add(def.name);
      definitions += index.definitions.length;
      imports += index.imports.length;
    }
    return {
      files: this.documents.size,
      openDocuments: this.openDocuments.size,
      symbols: symbols.size,
      definitions,
      imports,
      diagnosticsCacheEntries: this.db.memoCount(),
      workspaceRoots: [...this.workspaceRoots],
    };
  }

  // The current syntax epoch (the memo DB's revision): advanced by every text/index edit, never by a space
  // mutation. Runtime answers are stamped with it so an edit retires the ones computed against older source.
  public syntaxEpoch(): SyntaxEpoch {
    const revision: number = this.db.getRevision();
    return revision as SyntaxEpoch;
  }

  // The current atomspace epoch: advanced by space mutations only. Independent of the syntax epoch, so
  // evaluating never disturbs a static memo and editing never disturbs a runtime answer through this axis.
  public atomspaceEpoch(): AtomspaceEpoch {
    return this.atomspaceEpochValue as AtomspaceEpoch;
  }

  // Record a space mutation. Kept entirely outside the pure DB, so it can never invalidate a parse/index/
  // diagnostic memo (§3 epoch independence).
  public bumpAtomspaceEpoch(): void {
    this.atomspaceEpochValue += 1;
  }

  // Total executions of the cross-file diagnostic pass so far (observability + incrementality assertions).
  public diagnosticsComputationCount(): number {
    return this.diagnosticsComputations;
  }

  // A definitive runtime answer (get-type/get-doc from the live interpreter) valid at the current epochs, or
  // undefined on a miss. The RuntimeProvider that produces these answers is wired in a later step.
  public cachedRuntimeAnswer(method: string, args: string): string | undefined {
    return this.runtimeCache.get(method, args, this.currentEpochs());
  }

  // Store a definitive runtime answer, stamped with the current epochs.
  public cacheRuntimeAnswer(method: string, args: string, value: string): void {
    this.runtimeCache.set(method, args, this.currentEpochs(), value);
  }

  private currentEpochs(): { readonly syntaxEpoch: number; readonly atomspaceEpoch: number } {
    return { syntaxEpoch: this.db.getRevision(), atomspaceEpoch: this.atomspaceEpochValue };
  }

  public indexedUris(): string[] {
    return [...this.documents.keys()].sort();
  }

  public openDocumentUris(): string[] {
    return [...this.openDocuments].sort();
  }

  private buildDocumentIndex(uri: string, text: string, version: number | null): DocumentIndex {
    const parsed = parseMeTTa(uri, text, version);
    const commentsByLine = new Map<number, string>();
    for (const token of parsed.tokens) {
      if (token.type === "comment")
        commentsByLine.set(token.range.start.line, commentText(token.text));
    }

    const signatures: TypeSignature[] = [];
    const rawDefinitions: DefinitionRecord[] = [];
    const imports: ImportRecord[] = [];
    const spaces: DefinitionRecord[] = [];
    const locals: LocalBindingRecord[] = [];
    const definitionDeclarationKeys = new Set<string>();
    const definitionByContainer = new Map<string, DefinitionRecord>();

    walkAst(parsed.root, (node) => {
      if (node.kind !== "list") return;
      const children = semanticChildren(node);
      const head = namedChildText(children[0]);
      if (!head) return;

      if (head === ":" && children.length >= 3) {
        const nameNode = this.nameNodeFromDeclarationTarget(children[1]);
        if (!nameNode) return;
        const name = nameNode.text;
        const signature = makeSignature(name, children[2], nameNode.range, uri);
        if (signature) signatures.push(signature);
        const kind: DefinitionKind =
          signature?.raw === "Type" || STANDARD_TYPES.has(name) || /^[A-Z]/.test(name)
            ? "type"
            : "type";
        const def: DefinitionRecord = {
          name,
          kind,
          uri,
          range: node.range,
          selectionRange: nameNode.range,
          containerRange: node.range,
          signature,
          documentation: commentsBefore(node),
          detail: signature?.raw ?? children[2]?.text,
          exported: true,
        };
        rawDefinitions.push(def);
        definitionDeclarationKeys.add(rangeKey(nameNode.range));
        definitionByContainer.set(rangeKey(node.range), def);
        return;
      }

      if (head === "=" && children.length >= 3) {
        const pattern = children[1];
        const nameNode = this.nameNodeFromDeclarationTarget(pattern);
        if (!nameNode) return;
        const name = nameNode.text;
        const params = pattern?.kind === "list" ? semanticChildren(pattern).slice(1) : [];
        const def: DefinitionRecord = {
          name,
          kind: pattern?.kind === "list" ? "function" : "constant",
          uri,
          range: node.range,
          selectionRange: nameNode.range,
          containerRange: node.range,
          bodyRange: children[2]?.range,
          arity: params.length,
          documentation: commentsBefore(node),
          detail: pattern?.kind === "list" ? callLabel(name, params.length) : `(= ${name} value)`,
          exported: true,
        };
        rawDefinitions.push(def);
        definitionDeclarationKeys.add(rangeKey(nameNode.range));
        definitionByContainer.set(rangeKey(node.range), def);
        for (const param of params) {
          if (param.kind === "variable")
            locals.push({
              name: param.text,
              uri,
              range: param.range,
              scopeRange: node.range,
              kind: "parameter",
            });
        }
        return;
      }

      if ((head === "macro" || head === "defmacro") && children.length >= 2) {
        const pattern = children[1];
        const nameNode = this.nameNodeFromDeclarationTarget(pattern);
        if (!nameNode) return;
        const params = pattern?.kind === "list" ? semanticChildren(pattern).slice(1) : [];
        const def: DefinitionRecord = {
          name: nameNode.text,
          kind: "macro",
          uri,
          range: node.range,
          selectionRange: nameNode.range,
          containerRange: node.range,
          bodyRange: children[2]?.range,
          arity: params.length,
          documentation: commentsBefore(node),
          detail: `${head} ${callLabel(nameNode.text, params.length)}`,
          exported: true,
        };
        rawDefinitions.push(def);
        definitionDeclarationKeys.add(rangeKey(nameNode.range));
        definitionByContainer.set(rangeKey(node.range), def);
        for (const param of params) {
          if (param.kind === "variable")
            locals.push({
              name: param.text,
              uri,
              range: param.range,
              scopeRange: node.range,
              kind: "parameter",
            });
        }
        return;
      }

      if (head === "bind!" && children.length >= 2) {
        const nameNode = children[1];
        if (!nameNode || !isSymbolLike(nameNode)) return;
        const name = nameNode.text;
        const def: DefinitionRecord = {
          name,
          kind: isSpaceName(name) ? "space" : "binding",
          uri,
          range: node.range,
          selectionRange: nameNode.range,
          containerRange: node.range,
          documentation: commentsBefore(node),
          detail: `(bind! ${name} ...)`,
          exported: true,
        };
        rawDefinitions.push(def);
        spaces.push(def);
        definitionDeclarationKeys.add(rangeKey(nameNode.range));
        return;
      }

      if (head === "register-module!" && children.length >= 2) {
        const nameNode = children[1];
        if (!nameNode || !isSymbolLike(nameNode)) return;
        const moduleName = nodeTextWithoutQuotes(nameNode);
        const def: DefinitionRecord = {
          name: moduleName,
          kind: "module",
          uri,
          range: node.range,
          selectionRange: nameNode.range,
          containerRange: node.range,
          documentation: commentsBefore(node),
          detail: `(register-module! ${moduleName})`,
          exported: true,
        };
        rawDefinitions.push(def);
        definitionDeclarationKeys.add(rangeKey(nameNode.range));
        const filePath = this.uriToPath(uri);
        const baseDir = filePath ? path.dirname(filePath) : null;
        for (const child of children.slice(2)) {
          if (child.kind !== "string" && child.kind !== "symbol") continue;
          const raw = nodeTextWithoutQuotes(child);
          if (!baseDir) continue;
          const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
          this.moduleRoots.add(abs);
        }
        return;
      }

      if (isImportHead(head)) {
        // A top-level (import! …) runs only with a leading !; a bare one is inert data. The parser recorded
        // which top-level forms are banged, keyed by start offset; a nested import (no such key) counts as
        // banged so it is not flagged.
        const banged = parsed.topLevelBangs.get(node.offsetStart) ?? true;
        const imp = this.importFromNode(uri, text, node, children, head, banged);
        if (imp) imports.push(imp);
      }

      if (head === "let" && children.length >= 4) {
        const binding = children[1];
        const body = children[3];
        if (binding && body && binding.kind === "variable") {
          locals.push({
            name: binding.text,
            uri,
            range: binding.range,
            scopeRange: body.range,
            kind: "let",
          });
        }
      }

      if (head === "let*" && children.length >= 3) {
        const bindingList = children[1];
        const body = children[2];
        if (bindingList?.kind === "list" && body) {
          for (const pair of semanticChildren(bindingList)) {
            if (pair.kind !== "list") continue;
            const variable = semanticChildren(pair)[0];
            if (variable?.kind === "variable")
              locals.push({
                name: variable.text,
                uri,
                range: variable.range,
                scopeRange: body.range,
                kind: "let",
              });
          }
        }
      }

      if (head === "match" && children.length >= 4) {
        const pattern = children[2];
        const template = children[3];
        if (pattern && template) {
          for (const variable of collectVariables(pattern)) {
            locals.push({
              name: variable.text,
              uri,
              range: variable.range,
              scopeRange: template.range,
              kind: "match",
            });
          }
        }
      }

      if (head === "case" && children.length >= 3) {
        for (const arm of children.slice(2)) {
          if (arm.kind !== "list") continue;
          const armChildren = semanticChildren(arm);
          const pattern = armChildren[0];
          const body = armChildren[1];
          if (!pattern || !body) continue;
          for (const variable of collectVariables(pattern)) {
            locals.push({
              name: variable.text,
              uri,
              range: variable.range,
              scopeRange: body.range,
              kind: "case",
            });
          }
        }
      }
    });

    const signatureByName = new Map<string, TypeSignature[]>();
    for (const signature of signatures) {
      const existing = signatureByName.get(signature.name) ?? [];
      existing.push(signature);
      signatureByName.set(signature.name, existing);
    }
    const definitions = rawDefinitions.map((def) => {
      if (def.signature) return def;
      const matching = signatureByName.get(def.name)?.[0];
      if (!matching) return def;
      return { ...def, signature: matching, detail: def.detail ?? matching.raw };
    });

    const references: ReferenceRecord[] = [];
    const calls: FunctionCallInfo[] = [];

    const enclosingDefinitionForNode = (node: AstNode): string | undefined => {
      let current: AstNode | undefined = node;
      while (current) {
        const def = definitionByContainer.get(rangeKey(current.range));
        if (def?.kind === "function" || def?.kind === "macro" || def?.kind === "constant")
          return def.name;
        current = current.parent;
      }
      return undefined;
    };

    // A `(head …)` list is DATA when it sits, at any depth, in an argument position the enclosing form leaves
    // unevaluated (DATA_ARG_POSITIONS, from the stdlib meta-type signatures). Its head is then a
    // constructor/relation, not a function call, so it is not a candidate for the undefined/arity/type checks.
    const isInDataPosition = (node: AstNode): boolean => {
      let current: AstNode = node;
      while (current.parent) {
        const parent = current.parent;
        if (parent.kind === "list") {
          const kids = semanticChildren(parent);
          const index = kids.indexOf(current);
          if (index > 0) {
            const parentHead = namedChildText(kids[0]);
            if (parentHead && DATA_ARG_POSITIONS.get(parentHead)?.has(index - 1) === true)
              return true;
          }
        }
        current = parent;
      }
      return false;
    };

    walkAst(parsed.root, (node) => {
      if (node.kind === "list") {
        const children = semanticChildren(node);
        const first = children[0];
        const head = namedChildText(first);
        if (head && first && first.kind === "symbol") {
          const args = children.slice(1);
          const enclosingDefinition = enclosingDefinitionForNode(node);
          if (!isDefinitionHead(head) && !isInDataPosition(node)) {
            calls.push({
              uri,
              node,
              name: head,
              nameRange: first.range,
              args,
              enclosingDefinition,
            });
          }
          if (!definitionDeclarationKeys.has(rangeKey(first.range))) {
            references.push({
              name: head,
              uri,
              range: first.range,
              kind: isKeyword(head) ? "keyword-reference" : "call",
              enclosingDefinition,
            });
          }
        }
        return;
      }
      if (node.kind !== "symbol" && node.kind !== "variable") return;
      if (definitionDeclarationKeys.has(rangeKey(node.range))) return;
      const parent = node.parent;
      if (parent?.kind === "list" && semanticChildren(parent)[0] === node) return;
      const name = node.text;
      const enclosingDefinition = enclosingDefinitionForNode(node);
      const kind =
        node.kind === "variable"
          ? "variable-reference"
          : isSpaceName(name)
            ? "space-reference"
            : "reference";
      references.push({ name, uri, range: node.range, kind, enclosingDefinition });
    });

    return {
      uri,
      text,
      version,
      parsed,
      definitions,
      references,
      imports,
      signatures,
      spaces,
      calls,
      locals,
      commentsByLine,
    };
  }

  private nameNodeFromDeclarationTarget(target: AstNode | undefined): AstNode | null {
    if (!target) return null;
    if (target.kind === "symbol" || target.kind === "variable") return target;
    if (target.kind === "list") {
      const first = semanticChildren(target)[0];
      if (first?.kind === "symbol" || first?.kind === "variable") return first;
    }
    return null;
  }

  private importFromNode(
    uri: string,
    text: string,
    node: AstNode,
    children: readonly AstNode[],
    head: string,
    banged: boolean,
  ): ImportRecord | null {
    const filePath = this.uriToPath(uri);
    const baseDir = filePath ? path.dirname(filePath) : this.files.cwd();
    let targetSpace: string | undefined;
    let pathNode: AstNode | undefined;
    if (head === "import!") {
      if (children[1] && isSpaceName(children[1].text)) {
        targetSpace = children[1].text;
        pathNode = children[2];
      } else {
        pathNode = children[1];
      }
    } else {
      pathNode = children[1];
    }
    if (!pathNode) return null;
    // A PeTTa (library <name>) reference resolves by the bare library name, not the literal "(library …)" text,
    // and also looks in a conventional lib/ subdirectory.
    const libraryName = libraryRefName(pathNode);
    const rawPath = libraryName ?? nodeTextWithoutQuotes(pathNode);
    const resolvedUri = this.resolveImportUri(rawPath, baseDir, uri, libraryName !== null);
    const line = node.range.start.line;
    return {
      uri,
      range: lineRange(text, line, node.range.end.line),
      pathRange: pathNode.range,
      rawPath,
      lineText: fullLineText(text, line),
      resolvedUri: resolvedUri ?? undefined,
      exists: resolvedUri !== null,
      targetSpace,
      quoted: pathNode.kind === "string",
      banged,
    };
  }

  private resolveImportUri(
    rawPath: string,
    baseDir: string,
    sourceUri: string,
    library = false,
  ): string | null {
    if (!rawPath || rawPath.startsWith("&")) return null;
    const prologPath = isPrologPath(rawPath);
    const roots = prologPath
      ? new Set<string>([baseDir, this.files.cwd()])
      : new Set<string>([baseDir, ...this.moduleRoots]);
    if (!prologPath)
      for (const rootUri of this.workspaceRoots) {
        const rootPath = this.uriToPath(rootUri) ?? rootUri;
        roots.add(rootPath);
      }
    const candidates: string[] = [];
    const pushCandidate = (candidate: string): void => {
      candidates.push(candidate);
      if (!prologPath && !candidate.endsWith(".metta")) {
        candidates.push(`${candidate}.metta`);
      }
      if (!prologPath) candidates.push(path.join(candidate, "main.metta"));
    };

    const stripped = stripQuotes(rawPath);
    if (stripped.includes(":") && !path.isAbsolute(stripped)) {
      const rel = stripped.split(":").filter(Boolean).join(path.sep);
      for (const root of roots) pushCandidate(path.resolve(root, rel));
    } else if (path.isAbsolute(stripped)) {
      pushCandidate(path.resolve(stripped));
    } else {
      for (const root of roots) pushCandidate(path.resolve(root, stripped));
    }

    // A (library <name>) import also resolves from a conventional lib/ subdirectory of each root, and from
    // any git-fetched repo under repos/ (where git-import! clones its shallow checkouts).
    if (!prologPath && library && !path.isAbsolute(stripped) && !stripped.includes(":")) {
      for (const root of roots) {
        pushCandidate(path.resolve(root, "lib", stripped));
        const reposDir = path.resolve(root, "repos");
        for (const repo of this.files.readDir(reposDir) ?? []) {
          pushCandidate(path.resolve(reposDir, repo, stripped));
        }
      }
    }

    for (const candidate of candidates) {
      if (this.files.stat(candidate)?.isFile === true) {
        return this.pathToUri(candidate);
      }
    }

    if (prologPath) return null;

    // Handle imports that are module names matching already-indexed file basenames.
    const normalizedImport = stripped.toLowerCase();
    for (const indexedUri of this.documents.keys()) {
      if (indexedUri === sourceUri) continue;
      const indexedPath = this.uriToPath(indexedUri);
      if (!indexedPath) continue;
      const base = path.basename(indexedPath, path.extname(indexedPath)).toLowerCase();
      if (base === normalizedImport) return indexedUri;
    }
    return null;
  }

  // Ensure a file's transitive import closure is indexed and each index published to the DB, lazily loading
  // from disk exactly as the closure walk used to. This runs before any closure/diagnostics query so those
  // pure queries only ever read published inputs. A resolved import that cannot be loaded is published as
  // null, so its absence is a recorded fact rather than an unset-input error, and it stays out of the
  // closure just as a failed lazy-index did before.
  private materializeClosure(rootUri: string): void {
    const visited = new Set<string>();
    const queue = [normalizeUri(rootUri)];
    while (queue.length > 0) {
      const uri = queue.shift();
      if (uri === undefined || visited.has(uri)) continue;
      visited.add(uri);
      const index = this.documents.get(uri) ?? this.ensureIndexed(uri);
      this.publishIndexInput(uri, index ?? null);
      if (!index) continue;
      for (const imp of index.imports) {
        if (!imp.resolvedUri) continue;
        const resolved = normalizeUri(imp.resolvedUri);
        const resolvedPath = this.uriToPath(resolved);
        if (resolvedPath !== null && !isMettaFile(resolvedPath)) continue;
        if (!visited.has(resolved)) queue.push(resolved);
      }
    }
  }

  private visibleUris(sourceUri: string): Set<string> {
    const normalized = normalizeUri(sourceUri);
    this.materializeClosure(normalized);
    const closure = this.db.query(this.visibleClosureQuery, this.registry.idFor(normalized));
    const uris = new Set<string>();
    for (const fileId of closure) {
      const uri = this.registry.uriFor(fileId);
      if (uri !== undefined) uris.add(uri);
    }
    return uris;
  }

  public definitionsFor(
    name: string,
    sourceUri: string | null = null,
    visibleOnly = true,
    visibleOverride?: ReadonlySet<string>,
  ): DefinitionRecord[] {
    const definitions: DefinitionRecord[] = [];
    const ownBuiltin = BUILTIN_BY_NAME.get(name);
    // Prefer the line-accurate definition (into the generated stdlib reference) so Go to Definition lands on
    // the declaration; fall back to the base record only if the name is not in the generated set.
    if (ownBuiltin) definitions.push(builtinDefinition(name) ?? builtinToDefinition(ownBuiltin));
    if (STANDARD_TYPES.has(name) && !BUILTIN_BY_NAME.has(name)) {
      definitions.push(
        allBuiltinDefinitions().find((def) => def.name === name) ?? {
          name,
          kind: "type",
          uri: "metta://stdlib/types",
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          builtin: true,
        },
      );
    }
    const visible =
      visibleOverride ?? (sourceUri && visibleOnly ? this.visibleUris(sourceUri) : null);
    for (const def of this.definitionsByName.get(name) ?? []) {
      if (visible && !visible.has(def.uri)) continue;
      definitions.push(def);
    }
    // A symbol a built-in module the source file imports declares gets a synthetic definition, so hover,
    // go-to-definition, and completion treat it like a builtin — its type and docs come from the interpreter
    // via get-type/get-doc, which see the module because declarationContext runs the import.
    if (definitions.length === 0 && sourceUri !== null) {
      const sourceIndex = this.documents.get(normalizeUri(sourceUri));
      const moduleName = sourceIndex?.imports.find(
        (imp) =>
          BUILTIN_MODULE_NAMES.has(imp.rawPath) && builtinModuleSymbols(imp.rawPath).has(name),
      )?.rawPath;
      if (moduleName !== undefined) definitions.push(moduleSymbolDefinition(name, moduleName));
    }
    const seen = new Set<string>();
    return definitions.filter((def) => {
      const key = definitionKey(def);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  public allDefinitions(includeBuiltins = false): DefinitionRecord[] {
    const result: DefinitionRecord[] = includeBuiltins ? allBuiltinDefinitions() : [];
    for (const defs of this.definitionsByName.values()) result.push(...defs);
    return result;
  }

  // The text of a generated stdlib reference (metta://stdlib/…), served to the client content provider so Go
  // to Definition on a builtin opens a read-only document showing its declaration and documentation.
  public stdlibDocument(uri: string): string | null {
    return stdlibDocumentText(uri);
  }

  public validate(
    uri: string,
    settings: DiagnosticSettings = this.settings.diagnostics,
  ): Diagnostic[] {
    const normalized = normalizeUri(uri);
    // Lazily load and publish the closure, then let the memo DB answer: it reuses the cached diagnostics
    // unless this file's index or a visible file's index changed, and never re-runs on an edit to an
    // unrelated file. The clone lets callers mutate the returned ranges.
    this.materializeClosure(normalized);
    const index = this.documents.get(normalized);
    if (!index) return [];
    const result = this.assembleDiagnostics(index, normalized, settings);
    // Drop diagnostics silenced by an inline `; @suppress` directive or a lint.metta `(suppress <pattern>)`
    // rule. Lint already applied per-rule suppression to its own findings; this extends suppression uniformly
    // to the core, semantic, and bridge diagnostics. The suppressed set (with a reason per entry) is kept for
    // the transparency surfaces (`suppressedDiagnostics`, the CLI, and hover).
    const { visible } = this.applySuppressions(index, result);
    // Attach the docs codeDescription here, outside the memo, so a docs.baseUrl change is reflected on the
    // next validate without invalidating the pure diagnostics cache. A catalogued code links to its page.
    const base = this.settings.docs.baseUrl;
    if (base.length === 0) return visible;
    return visible.map((diagnostic) => {
      const href = diagnosticDocsUrl(
        base,
        typeof diagnostic.code === "string" ? diagnostic.code : undefined,
      );
      return href !== null ? { ...diagnostic, codeDescription: { href } } : diagnostic;
    });
  }

  // Assemble the full diagnostics list from the memoized core computation plus the lint, semantic-lint, and
  // host-bridge passes, before suppression. Shared by `validate` and `suppressedDiagnostics` so both
  // partition the same set.
  private assembleDiagnostics(
    index: DocumentIndex,
    normalized: string,
    settings: DiagnosticSettings,
  ): Diagnostic[] {
    const result = this.db
      .query(this.diagnosticsQuery, {
        id: this.registry.idFor(normalized),
        settingsKey: diagnosticSettingsKey(settings),
        settings,
      })
      .map((diagnostic) => ({ ...diagnostic, range: cloneRange(diagnostic.range) }));
    // A lint.metta is the rule file itself (metadata, not target code), so the rules, the interpreter passes,
    // and the host bridge do not apply to it — its own (pattern (debug! $X)) would otherwise match the
    // no-debug rule. Its schema is validated separately by the lint parser.
    const ruleFile = isLintConfigFile(normalized);
    // A lint.metta's own schema errors surface here (gated on the lint setting), so a rule that fails to parse
    // is reported on the rule file instead of silently doing nothing.
    if (settings.lint && ruleFile) {
      const offsets = index.parsed.lineOffsets;
      for (const issue of parseRules(index.text).issues)
        result.push(ruleIssueToDiagnostic(issue, offsets));
    }
    // Lint depends on lint.metta (rules + severities), not a memo DB input, so it runs as its own cheap pass.
    if (settings.lint && !ruleFile) {
      const offsets = index.parsed.lineOffsets;
      for (const finding of this.lintFindings(normalized))
        result.push(lintFindingToDiagnostic(finding, offsets));
    }
    // Semantic lint runs the interpreter. Standalone analyzer users run it synchronously; the Node LSP
    // server switches to cached mode and fills this slot from a background worker.
    if (settings.semanticLint && !ruleFile) {
      if (this.semanticLintMode === "cached") {
        const cached = this.cachedSemanticLintDiagnostics(normalized);
        if (cached.length > 0) result.push(...cached);
      } else result.push(...this.semanticLintDiagnostics(normalized));
    }
    if (settings.prolog && !ruleFile) {
      if (this.prologDiagnosticsMode === "cached") {
        const cached = this.cachedPrologDiagnostics(normalized);
        if (cached.length > 0) result.push(...cached);
      } else result.push(...this.prologBridgeDiagnostics(index));
    }
    // Bridge diagnostics depend on the host TypeScript, not a memo input; inert unless a bridge is attached.
    if (settings.bridge && this.bridge && !ruleFile)
      result.push(...this.bridgeDiagnostics(normalized));
    return result;
  }

  // The `(suppress <pattern>)` rules from the file's nearest lint.metta.
  private suppressRulesFor(index: DocumentIndex): readonly SuppressRule[] {
    const filePath = this.uriToPath(index.uri);
    return filePath === null ? [] : this.configLoader.suppressesForFile(filePath);
  }

  // Partition assembled diagnostics into those shown and those silenced, recording why each was silenced so
  // the transparency surfaces can report it. A diagnostic is dropped when an inline `; @suppress` directive
  // covers its code (or silences the line or the file wholesale), or when a lint.metta `(suppress <pattern>)`
  // rule matches a form the diagnostic sits inside.
  private applySuppressions(
    index: DocumentIndex,
    diagnostics: readonly Diagnostic[],
  ): { visible: Diagnostic[]; suppressed: SuppressedDiagnostic[] } {
    const inline = buildSuppressions(index.text);
    const spans = patternSuppressionSpans(index.text, this.suppressRulesFor(index));
    const lineOffsets = index.parsed.lineOffsets;
    const visible: Diagnostic[] = [];
    const suppressed: SuppressedDiagnostic[] = [];
    for (const diagnostic of diagnostics) {
      const code = typeof diagnostic.code === "string" ? diagnostic.code : "";
      const inlineKind = inlineSuppression(code, diagnostic.range.start.line, inline);
      if (inlineKind !== null) {
        suppressed.push({
          diagnostic,
          reason: inlineKind === "file" ? "; @suppress-file directive" : "; @suppress directive",
        });
        continue;
      }
      const offset =
        (lineOffsets[diagnostic.range.start.line] ?? 0) + diagnostic.range.start.character;
      const span = spans.find(
        (candidate) =>
          offset >= candidate.start &&
          offset < candidate.end &&
          (candidate.codes === "all" || candidate.codes.has(code)),
      );
      if (span !== undefined) {
        suppressed.push({ diagnostic, reason: `lint.metta ${span.rule.text}` });
        continue;
      }
      visible.push(diagnostic);
    }
    return { visible, suppressed };
  }

  // The diagnostics this document produced that a suppression silenced, each with its reason. Powers the CLI
  // `check --show-suppressed`, the DSL, and the hover on a suppression directive, so suppression is never
  // invisible.
  public suppressedDiagnostics(uri: string): SuppressedDiagnostic[] {
    const normalized = normalizeUri(uri);
    this.materializeClosure(normalized);
    const index = this.documents.get(normalized);
    if (!index) return [];
    const settings = this.settings.diagnostics;
    const result = this.assembleDiagnostics(index, normalized, settings);
    const suppressed = this.applySuppressions(index, result).suppressed;
    // Lint findings a `; @suppress <rule-id>` silenced are dropped inside the linter, before the assembled
    // set, so collect them directly for a complete picture of what is hidden.
    if (settings.lint) {
      const offsets = index.parsed.lineOffsets;
      for (const finding of lintDocumentTracked(index.text, this.lintOptionsFor(index)).suppressed)
        suppressed.push({
          diagnostic: lintFindingToDiagnostic(finding, offsets),
          reason: "; @suppress directive (lint rule)",
        });
    }
    return suppressed.sort((a, b) => compareRange(a.diagnostic.range, b.diagnostic.range));
  }

  public semanticLintInput(uri: string): SemanticLintInput | null {
    const normalized = normalizeUri(uri);
    const index = this.documents.get(normalized);
    if (!index || isLintConfigFile(normalized)) return null;
    const filePath = this.uriToPath(normalized);
    const severities =
      filePath === null ? {} : this.configLoader.resolveForFile(filePath).config.lint.severities;
    return {
      uri: normalized,
      version: index.version,
      sourceFingerprint: semanticLintSourceFingerprint(index.text),
      text: index.text,
      severities,
      severityKey: semanticLintSeverityKey(severities),
    };
  }

  public hasFreshSemanticLintDiagnostics(uri: string): boolean {
    const input = this.semanticLintInput(uri);
    if (input === null) return false;
    const cached = this.semanticLintCache.get(input.uri);
    return (
      cached !== undefined &&
      cached.version === input.version &&
      cached.sourceFingerprint === input.sourceFingerprint &&
      cached.severityKey === input.severityKey
    );
  }

  public setSemanticLintDiagnostics(
    uri: string,
    version: number | null,
    sourceFingerprint: string,
    severityKey: string,
    diagnostics: readonly Diagnostic[],
  ): void {
    this.semanticLintCache.set(normalizeUri(uri), {
      version,
      sourceFingerprint,
      severityKey,
      diagnostics: diagnostics.map(cloneDiagnostic),
    });
  }

  public clearSemanticLintDiagnostics(uri: string): void {
    this.semanticLintCache.delete(normalizeUri(uri));
  }

  public clearAllSemanticLintDiagnostics(): void {
    this.semanticLintCache.clear();
  }

  public prologDiagnosticsInput(uri: string): PrologDiagnosticsInput | null {
    const normalized = normalizeUri(uri);
    const index = this.documents.get(normalized);
    if (!index || isLintConfigFile(normalized)) return null;
    const references = this.prologFileReferences(index);
    if (references.length === 0) return null;
    return {
      uri: normalized,
      version: index.version,
      references,
      referenceKey: prologReferencesKey(references),
      settingsKey: prologSettingsKey(this.settings.prolog),
    };
  }

  public hasFreshPrologDiagnostics(uri: string): boolean {
    const input = this.prologDiagnosticsInput(uri);
    if (input === null) return false;
    const cached = this.prologDiagnosticsCache.get(input.uri);
    return (
      cached !== undefined &&
      cached.version === input.version &&
      cached.referenceKey === input.referenceKey &&
      cached.settingsKey === input.settingsKey
    );
  }

  public setPrologBridgeDiagnostics(
    uri: string,
    version: number | null,
    referenceKey: string,
    settingsKey: string,
    diagnostics: readonly Diagnostic[],
  ): void {
    this.prologDiagnosticsCache.set(normalizeUri(uri), {
      version,
      referenceKey,
      settingsKey,
      diagnostics: diagnostics.map(cloneDiagnostic),
    });
  }

  public clearPrologDiagnostics(uri: string): void {
    this.prologDiagnosticsCache.delete(normalizeUri(uri));
  }

  public clearAllPrologDiagnostics(): void {
    this.prologDiagnosticsCache.clear();
  }

  private cachedSemanticLintDiagnostics(uri: string): Diagnostic[] {
    const input = this.semanticLintInput(uri);
    if (input === null) return [];
    const cached = this.semanticLintCache.get(input.uri);
    if (
      cached === undefined ||
      cached.version !== input.version ||
      cached.sourceFingerprint !== input.sourceFingerprint ||
      cached.severityKey !== input.severityKey
    )
      return [];
    return cached.diagnostics.map(cloneDiagnostic);
  }

  private cachedPrologDiagnostics(uri: string): Diagnostic[] {
    const input = this.prologDiagnosticsInput(uri);
    if (input === null) return [];
    const cached = this.prologDiagnosticsCache.get(input.uri);
    if (
      cached === undefined ||
      cached.version !== input.version ||
      cached.referenceKey !== input.referenceKey ||
      cached.settingsKey !== input.settingsKey
    )
      return [];
    return cached.diagnostics.map(cloneDiagnostic);
  }

  // Interpreter-backed lint diagnostics: run the semantic rules and place each violation at its subject
  // symbol's definition. Exposed for the CLI. Returns an empty list when the runtime is unavailable.
  public semanticLintDiagnostics(uri: string): Diagnostic[] {
    const input = this.semanticLintInput(uri);
    if (input === null) return [];
    return this.semanticLintViolationsToDiagnostics(
      input.uri,
      runSemanticLint(input.text, input.severities),
    );
  }

  public semanticLintViolationsToDiagnostics(
    uri: string,
    violations: readonly SemanticViolation[],
  ): Diagnostic[] {
    const normalized = normalizeUri(uri);
    const diagnostics: Diagnostic[] = [];
    for (const violation of violations) {
      const definition = this.definitionsFor(violation.symbol, normalized, false).find(
        (record) => normalizeUri(record.uri) === normalized,
      );
      const range = definition?.selectionRange ??
        definition?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
      diagnostics.push({
        range: cloneRange(range),
        message: violation.message,
        severity:
          violation.severity === "deny" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        source: "metta-semantic-lint",
        code: violation.rule,
      });
    }
    return diagnostics;
  }

  // The lint options (project rules + per-rule severity overrides) from a document's nearest lint.metta.
  private lintOptionsFor(index: DocumentIndex): LintOptions {
    const filePath = this.uriToPath(index.uri);
    if (filePath === null) return {};
    const resolved = this.configLoader.resolveForFile(filePath);
    return { extraRules: resolved.rules, severities: resolved.config.lint.severities };
  }

  // The syntactic lint findings for a document: the built-in rule pack plus any project rules from lint.metta,
  // with per-rule severity overrides applied. Exposed for the CLI and MCP lint surfaces.
  public lintFindings(uri: string): LintFinding[] {
    const normalized = normalizeUri(uri);
    const index = this.documents.get(normalized);
    if (!index) return [];
    return lintDocument(index.text, this.lintOptionsFor(index));
  }

  // The pure diagnostics computation over an already-materialized closure: the syntactic, import-resolution,
  // and cross-file semantic checks. This is the previous inline body unchanged, except the cross-file
  // lookups take the precomputed visible set instead of recomputing it, so the result is a pure function of
  // the file's own index, the visible files' indexes, and the settings — exactly the dependency set the
  // diagnostics query records.
  private computeDiagnostics(
    index: DocumentIndex,
    closureUris: ReadonlySet<string>,
    settings: DiagnosticSettings,
  ): Diagnostic[] {
    this.diagnosticsComputations += 1;
    const diagnostics: Diagnostic[] = [];
    const add = (
      range: Range,
      message: string,
      severity: DiagnosticSeverity = DiagnosticSeverity.Warning,
      code?: string,
      data?: unknown,
    ): void => {
      diagnostics.push({
        range: asDiagnosticRange(range),
        message,
        severity,
        code,
        source: "metta-ts-lsp",
        ...(data !== undefined ? { data } : {}),
      });
    };

    if (settings.syntax) {
      for (const diag of index.parsed.diagnostics) {
        diagnostics.push({
          range: asDiagnosticRange(diag.range),
          message: diag.message,
          severity: (diag.severity as DiagnosticSeverity | undefined) ?? DiagnosticSeverity.Error,
          code: diag.code,
          source: "metta-ts-parser",
        });
      }
    }

    if (settings.importResolution) {
      for (const imp of index.imports) {
        // A built-in module (json/catalog/fileio/…) resolves through the interpreter, not a file on disk.
        if (!imp.exists && !BUILTIN_MODULE_NAMES.has(imp.rawPath))
          add(
            imp.pathRange,
            diagnosticMessage.unresolvedImport(imp.rawPath),
            DiagnosticSeverity.Warning,
            "import.unresolved",
          );
        // A resolvable import that is not banged never runs: its module's symbols are undefined at runtime
        // even though navigation resolves them. A leading ! executes it.
        if (!imp.banged && (imp.exists || BUILTIN_MODULE_NAMES.has(imp.rawPath))) {
          add(
            imp.range,
            diagnosticMessage.unbangedImport(imp.rawPath),
            DiagnosticSeverity.Warning,
            "import.notRun",
          );
        }
      }
      for (const issue of this.collectPrologFileReferences(index).unresolved) {
        add(
          issue.range,
          diagnosticMessage.unresolvedPrologFile(issue.rawPath),
          DiagnosticSeverity.Warning,
          "prolog.unresolved",
        );
      }
    }

    if (settings.duplicateDefinitions) {
      const groups = new Map<string, DefinitionRecord[]>();
      const defs =
        settings.duplicateDefinitionsMode === "global"
          ? this.allVisibleDefinitions(index.uri, false, closureUris)
          : index.definitions;
      for (const def of defs) {
        if (def.builtin === true || def.kind === "type") continue;
        const sourceIndex =
          normalizeUri(def.uri) === index.uri ? index : this.documents.get(normalizeUri(def.uri));
        const key = duplicateDefinitionKey(def, sourceIndex);
        const existing = groups.get(key) ?? [];
        existing.push(def);
        groups.set(key, existing);
      }
      for (const defs of groups.values()) {
        if (defs.length <= 1) continue;
        for (const def of defs) {
          if (normalizeUri(def.uri) === index.uri)
            add(
              def.selectionRange,
              diagnosticMessage.duplicateDefinition(def.kind, def.name, def.arity),
              DiagnosticSeverity.Warning,
              "definition.duplicate",
            );
        }
      }
    }

    if (settings.undefinedFunctions || settings.arity || settings.typeMismatch) {
      // A file that imports a built-in module (json/catalog/fileio/…) sees the module's declared symbols as
      // known — read from core's own builtinModules(), so it tracks the interpreter.
      const importedModuleSymbols = new Set<string>();
      for (const imp of index.imports)
        if (BUILTIN_MODULE_NAMES.has(imp.rawPath))
          for (const symbol of builtinModuleSymbols(imp.rawPath)) importedModuleSymbols.add(symbol);
      // A did-you-mean suggester over the visible symbol names, using core's one consolidated fuzzy engine.
      // Built lazily from the cross-file known set so a file with no unknown symbols pays nothing.
      let fuzzy: FuzzyMatcher | undefined;
      const suggestName = (typo: string): string | undefined => {
        if (fuzzy === undefined) {
          const known = new Set<string>();
          for (const def of this.allVisibleDefinitions(index.uri, false, closureUris))
            known.add(def.name);
          for (const builtinName of BUILTIN_BY_NAME.keys()) known.add(builtinName);
          for (const type of STANDARD_TYPES) known.add(type);
          for (const form of SPECIAL_FORMS) known.add(form);
          for (const symbol of importedModuleSymbols) known.add(symbol);
          fuzzy = new FuzzyMatcher(known);
        }
        return fuzzy.suggest(typo)[0];
      };
      // One batched interpreter run computes the type/arity verdict for every call up front, so the file's
      // declaration context is built once for the whole validate, not once per call site.
      const typeVerdicts =
        settings.arity || settings.typeMismatch
          ? this.liveCheckTypes(
              index.uri,
              index.calls.map((call) =>
                index.text.slice(call.node.offsetStart, call.node.offsetEnd),
              ),
            )
          : new Map<string, TypeCheckError | null>();
      for (const call of index.calls) {
        const name = call.name;
        if (name === "!" || name === "=" || name === ":" || name === "->") continue;
        const builtin = BUILTIN_BY_NAME.get(name);
        const visibleDefs = this.definitionsFor(name, index.uri, true, closureUris).filter(
          (def) => def.builtin !== true,
        );
        const actualArity = call.args.length;
        const hasAny =
          Boolean(builtin) ||
          visibleDefs.length > 0 ||
          isKeyword(name) ||
          importedModuleSymbols.has(name);
        if (settings.undefinedFunctions && !hasAny && !isLintConfigFile(index.uri)) {
          // An unknown head is valid data in MeTTa: it reduces to itself, and a definition may be added
          // later, so it is never an "undefined" error. Three hints are worth surfacing, all as hints and
          // never as errors. Exact matches win over a fuzzy guess: an exact built-in module export and an
          // exact symbol defined in another workspace file each just need an import; only then does a
          // Levenshtein near-miss of a known name (the tolerance compilers use) suggest a correction.
          // Otherwise, say nothing.
          const module = moduleExportingSymbol(name);
          const importPath =
            module === undefined ? this.crossFileImportFor(name, index.uri) : undefined;
          const suggestion =
            module === undefined && importPath === undefined ? suggestName(name) : undefined;
          if (module !== undefined) {
            add(
              call.nameRange,
              diagnosticMessage.needsImport(name, module),
              DiagnosticSeverity.Hint,
              "symbol.needsImport",
              { module, name },
            );
          } else if (importPath !== undefined) {
            add(
              call.nameRange,
              diagnosticMessage.needsImportFrom(name, importPath),
              DiagnosticSeverity.Hint,
              "symbol.needsImport",
              { importPath, name },
            );
          } else if (suggestion !== undefined) {
            add(
              call.nameRange,
              diagnosticMessage.possibleTypo(name, suggestion),
              DiagnosticSeverity.Hint,
              "symbol.possibleTypo",
              { suggestion, name },
            );
          }
          continue;
        }
        if (settings.arity || settings.typeMismatch) {
          // Interpreter-backed type + arity check: `check-types` runs the evaluator's own applicability check
          // (Hyperon `check_if_function_type_is_applicable`) and returns the exact Error atom it would produce —
          // a wrong-arity `IncorrectNumberOfArguments` or a wrong-argument `(BadArgType i expected actual)` —
          // with no body evaluation and no TS type heuristic. A call the interpreter leaves unreduced (an
          // Atom-typed data slot: quote/add-atom/match patterns, if/case branches) is not in index.calls, so it
          // is never checked here, exactly as the interpreter never type-checks it.
          const callSource = index.text.slice(call.node.offsetStart, call.node.offsetEnd);
          const verdict = typeVerdicts.get(callSource) ?? null;
          if (verdict?.kind === "arity" && settings.arity) {
            const arities = this.expectedArities(index.uri, name);
            add(
              call.nameRange,
              diagnosticMessage.argumentCountMismatch(
                name,
                arities.length > 0 ? arities.join(" or ") : "a different number",
                actualArity,
                this.liveType(index.uri, name) ?? undefined,
              ),
              DiagnosticSeverity.Warning,
              "call.arity",
            );
          } else if (verdict?.kind === "badArg" && settings.typeMismatch) {
            add(
              call.args[verdict.index - 1]?.range ?? call.nameRange,
              diagnosticMessage.typeMismatch(name, verdict.index, verdict.expected, verdict.actual),
              DiagnosticSeverity.Warning,
              "call.typeMismatch",
            );
          } else if (verdict?.kind === "badType" && settings.typeMismatch) {
            add(
              call.nameRange,
              diagnosticMessage.returnTypeMismatch(name, verdict.expected, verdict.actual),
              DiagnosticSeverity.Warning,
              "call.typeMismatch",
            );
          }
          // A parameter typed Variable binds a $-variable; a plain symbol there does not reduce at run time
          // (verified against Hyperon and metta-ts). check-types is permissive for an untyped symbol, so this
          // is flagged separately, matching MeTTaTron's variable-format feedback.
          if (settings.typeMismatch) {
            for (const position of VARIABLE_ARG_POSITIONS.get(name) ?? []) {
              const arg = call.args[position];
              if (arg?.kind !== "symbol") continue;
              const suggestion = variableFormatSuggestion(arg.text);
              add(
                arg.range,
                diagnosticMessage.variableSlot(name, position + 1, suggestion),
                DiagnosticSeverity.Warning,
                "call.variableSlot",
                suggestion !== undefined ? { suggestion, name: arg.text } : undefined,
              );
            }
          }
        }
      }
    }

    if (settings.undefinedTypes) {
      const knownTypes = new Set<string>(STANDARD_TYPES);
      for (const def of this.allVisibleDefinitions(index.uri, false, closureUris))
        if (def.kind === "type") knownTypes.add(def.name);
      const canonicalTypeByLower = new Map<string, string>();
      for (const known of knownTypes) canonicalTypeByLower.set(known.toLowerCase(), known);
      const typeFuzzy = new FuzzyMatcher(knownTypes);
      for (const signature of index.signatures) {
        const typeNames = signature.raw.match(/[A-Za-z_%][A-Za-z0-9_?!%.-]*/g) ?? [];
        for (const typeName of typeNames) {
          if (typeName === signature.name || typeName === "->") continue;
          if (STANDARD_TYPES.has(typeName) || BUILTIN_BY_NAME.has(typeName)) continue;
          if (
            this.definitionsFor(typeName, index.uri, true, closureUris).some(
              (def) => def.kind === "type",
            )
          )
            continue;
          // A miscapitalized known type (number -> Number) is flagged even though it is lowercase, matching
          // MeTTaTron; otherwise only an uppercase name reads as an intended-but-undefined type, and a
          // near-miss of a known type is offered as the correction.
          const caseMatch = canonicalTypeByLower.get(typeName.toLowerCase());
          const miscapitalized = caseMatch !== undefined && caseMatch !== typeName;
          if (!miscapitalized && !/^[A-Z]/.test(typeName)) continue;
          const suggestion = miscapitalized ? caseMatch : typeFuzzy.suggest(typeName)[0];
          add(
            signature.range,
            diagnosticMessage.undefinedType(typeName, signature.name, suggestion),
            DiagnosticSeverity.Warning,
            "type.undefined",
          );
        }
      }
    }

    if (settings.unboundSpaces) {
      const knownSpaces = new Set(["&self"]);
      for (const def of this.allVisibleDefinitions(index.uri, false, closureUris)) {
        if (def.kind === "space" || def.kind === "binding") knownSpaces.add(def.name);
      }
      const spaceFuzzy = new FuzzyMatcher(knownSpaces);
      for (const ref of index.references) {
        if (ref.kind !== "space-reference") continue;
        if (isLintConfigFile(index.uri) || knownSpaces.has(ref.name)) continue;
        const suggestion = spaceFuzzy.suggest(ref.name)[0];
        add(
          ref.range,
          diagnosticMessage.unboundSpace(ref.name, suggestion),
          DiagnosticSeverity.Warning,
          "space.unbound",
          suggestion !== undefined ? { suggestion, name: ref.name } : undefined,
        );
      }
    }

    if (settings.undefinedVariables) {
      for (const ref of index.references) {
        if (ref.kind !== "variable-reference") continue;
        if (!this.isLocalVariableDefined(index, ref.name, ref.range.start)) {
          add(
            ref.range,
            diagnosticMessage.undefinedVariable(ref.name),
            DiagnosticSeverity.Hint,
            "variable.undefined",
          );
        }
      }
    }

    for (const ref of index.references) {
      if (!ref.name.startsWith("$")) continue;
      if (ref.name.includes("#"))
        add(
          ref.range,
          diagnosticMessage.reservedHash(ref.name),
          DiagnosticSeverity.Hint,
          "variable.reservedHash",
        );
      // Core tokenization has changed across MeTTa TS versions: some builds keep `;` inside the variable token,
      // others stop the token immediately before it. Both forms are the same source hazard, since the semicolon
      // silently comments out the rest of the line in parsers that treat it as a comment delimiter.
      const afterOffset =
        (index.parsed.lineOffsets[ref.range.end.line] ?? 0) + ref.range.end.character;
      if (ref.name.includes(";") || index.text.charAt(afterOffset) === ";")
        add(
          ref.range,
          diagnosticMessage.suspiciousSemicolon(ref.name),
          DiagnosticSeverity.Hint,
          "variable.suspiciousSemicolon",
        );
    }

    return diagnostics.sort((a, b) => compareRange(a.range, b.range));
  }

  private allVisibleDefinitions(
    uri: string,
    includeBuiltins: boolean,
    visibleOverride?: ReadonlySet<string>,
  ): DefinitionRecord[] {
    const visible = visibleOverride ?? this.visibleUris(uri);
    const defs: DefinitionRecord[] = includeBuiltins ? allBuiltinDefinitions() : [];
    for (const group of this.definitionsByName.values()) {
      for (const def of group) {
        if (visible.has(def.uri)) defs.push(def);
      }
    }
    return defs;
  }

  private isLocalVariableDefined(index: DocumentIndex, name: string, position: Position): boolean {
    return index.locals.some(
      (local) => local.name === name && rangeContainsPosition(local.scopeRange, position),
    );
  }

  public symbolAt(uri: string, position: Position): SymbolAtPosition | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const token = findTokenAtPosition(index.parsed.tokens, position);
    if (
      !token ||
      (token.type !== "symbol" &&
        token.type !== "variable" &&
        token.type !== "string" &&
        token.type !== "number")
    )
      return null;
    const node =
      findNodeAtPosition(
        index.parsed.root,
        position,
        (candidate) =>
          candidate.offsetStart === token.offsetStart && candidate.offsetEnd === token.offsetEnd,
      ) ??
      findNodeAtPosition(
        index.parsed.root,
        position,
        (candidate) => candidate.kind === "symbol" || candidate.kind === "variable",
      );
    if (!node) return null;
    const name = token.type === "string" ? stripQuotes(token.text) : token.text;
    const kind: SymbolAtPosition["kind"] =
      token.type === "variable" ? "variable" : token.text.startsWith("&") ? "space" : "unknown";
    return { node, token, name, kind };
  }

  // Hover content for a `; @suppress` / `; @suppress-file` directive: the diagnostics it silences on its
  // covered lines (with codes and messages), or a note that it silences nothing. Returns null when the
  // position is not on such a directive, so the normal hover takes over.
  private suppressionHover(uri: string, position: Position): Hover | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const lineText = fullLineText(index.text, position.line);
    const at = lineText.indexOf("@suppress");
    if (at === -1) return null;
    const semicolon = lineText.lastIndexOf(";", at);
    if (semicolon === -1 || position.character < semicolon) return null;
    const isFile = lineText.slice(at).startsWith("@suppress-file");
    const silenced = this.suppressedDiagnostics(uri).filter((entry) => {
      if (isFile) return entry.reason.includes("@suppress-file");
      // Inline per-line directives read as "; @suppress …"; pattern reasons read "lint.metta …". A per-line
      // directive covers its own line and the next.
      if (!entry.reason.startsWith(";") || entry.reason.includes("@suppress-file")) return false;
      const line = entry.diagnostic.range.start.line;
      return line === position.line || line === position.line + 1;
    });
    const header = isFile
      ? "**`; @suppress-file`** silences these for the whole file:"
      : "**`; @suppress`** silences these on the following line:";
    const body =
      silenced.length === 0
        ? "\n\n_Nothing here is silenced — this directive is unused._"
        : `\n${silenced.map((entry) => `- \`${String(entry.diagnostic.code)}\` — ${diagnosticText(entry.diagnostic.message)}`).join("\n")}`;
    return { contents: { kind: MarkupKind.Markdown, value: header + body } };
  }

  public hover(
    uri: string,
    position: Position,
    settings: HoverSettings = this.settings.hover,
  ): Hover | null {
    // A `; @suppress` directive hovers to show what it hides (or that it hides nothing), so suppression is
    // inspectable without leaving the editor.
    const directive = this.suppressionHover(uri, position);
    if (directive !== null) return directive;
    const symbol = this.symbolAt(uri, position);
    if (!symbol) return null;
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    // In a lint.metta rule file, the DSL vocabulary (lint-rule, pattern, message, …) hovers with an
    // explanation, so writing a rule is as guided as reading the code it matches.
    if (isLintConfigFile(normalizeUri(uri))) {
      const dsl = LINT_DSL_HOVER.get(symbol.name);
      if (dsl)
        return { contents: { kind: MarkupKind.Markdown, value: dsl }, range: symbol.token.range };
    }
    if (symbol.kind === "variable") {
      const local = index.locals.find(
        (candidate) =>
          candidate.name === symbol.name && rangeContainsPosition(candidate.scopeRange, position),
      );
      // rust-analyzer style: the term in a highlighted fence, then a subtle role line.
      const role = local ? `${local.kind} binding` : "MeTTa logic variable";
      const value = `${markdownCode("metta", symbol.name).trimStart()}\n\n_${role}_`;
      return { contents: { kind: MarkupKind.Markdown, value }, range: symbol.token.range };
    }
    const binding = this.hostBindingFor(uri, position, symbol);
    const defs = this.definitionsFor(symbol.name, uri);
    if (defs.length === 0) {
      // No MeTTa definition, but a host binding — a `(js-atom "..")` global, or an operation with no `(: ..)`
      // declared in MeTTa — still hovers with the resolved host signature.
      if (binding)
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: hostBindingHoverLines(binding).join("\n\n"),
          },
          range: symbol.token.range,
        };
      return null;
    }
    const def = defs[0];
    if (!def) return null;
    // The interpreter-exact type from live @metta-ts/core introspection, cached by both epochs (exactly what
    // `!(get-type <symbol>)` returns). It backs the signature when nothing static is declared; an %Undefined%
    // or Atom answer carries no information, so it is not shown.
    const interpreterType = this.liveType(uri, symbol.name);
    const informativeType =
      interpreterType !== null && !hostTypeAcceptsAny(interpreterType) ? interpreterType : null;
    // `detail` is a signature only when it is a MeTTa form; for some symbols it is a prose category (a type's
    // "standard type"), which belongs in the docs, not the code fence.
    const detailSignature = def.detail?.startsWith("(") === true ? def.detail : null;
    const signatureSource =
      def.signature?.raw !== undefined
        ? "declared type"
        : informativeType !== null
          ? "interpreter type"
          : def.kind;
    let signature =
      def.signature?.raw ??
      detailSignature ??
      informativeType ??
      (def.arity !== undefined ? callLabel(def.name, def.arity) : def.name);
    // Keep the name visible in the fence (rust-analyzer shows it in the signature). A bare arrow type, from a
    // `(: name type)` declaration or get-type, omits the name, so present the whole declaration.
    if (signature.startsWith("(->")) signature = `(: ${def.name} ${signature})`;

    // rust-analyzer's hover layout: the signature in a syntax-highlighted fence, a horizontal rule, the
    // documentation, then a subtle origin line. The signature carries the kind (no separate badge), and the
    // origin replaces the old metadata bullets — Go to Definition covers the exact location.
    const sections: string[] = [markdownCode("metta", signature).trimStart()];

    const docs: string[] = [];
    // A builtin type's prose doc just restates the name ("Standard MeTTa type Number."), so skip it; builtin
    // functions and user symbols keep their documentation.
    const showDoc = def.builtin === true ? def.kind !== "type" : settings.userDefinitionComments;
    // The interpreter's own @doc (get-doc) supersedes the catalog blurb when present — one description, not
    // two. The catalog remains the fallback for builtins metta-ts does not document yet.
    const liveDoc = this.liveDoc(uri, symbol.name);
    if (liveDoc !== null) docs.push(liveDoc);
    else if (def.documentation && showDoc) docs.push(def.documentation);
    if (docs.length > 0) sections.push(docs.join("\n\n"));

    // Terse origin: the kind for a builtin ("builtin type"), the file for a user symbol. Go to Definition
    // takes the reader to the actual declaration.
    const origin =
      def.builtin === true
        ? `builtin ${def.kind}`
        : `${signatureSource} · ${relativeDisplayPath(def.uri, this.getWorkspaceRoots())}`;
    const footer = [`_${origin}_`];
    // Builtins link to the docs catalog when a base is configured; user symbols are not catalogued.
    const docsUrl =
      def.builtin === true ? builtinDocsUrl(this.settings.docs.baseUrl, def.name) : null;
    if (docsUrl !== null) footer.push(`[Open docs](${docsUrl})`);
    sections.push(footer.join(" · "));

    // When the cursor is inside a runnable form, preview what it reduces to (guarded, safe).
    const preview = this.evaluationPreview(index, position);
    if (preview !== null) sections.push(preview);
    // A grounded operation carries both its MeTTa definition and its TypeScript host signature.
    if (binding) sections.push(hostBindingHoverLines(binding).join("\n\n"));
    return {
      contents: { kind: MarkupKind.Markdown, value: sections.join("\n\n---\n\n") },
      range: symbol.token.range,
    };
  }

  public definition(uri: string, position: Position): Location[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol) return [];
    if (symbol.kind === "variable")
      return this.variableReferences(uri, symbol.name, position, true).slice(0, 1);
    const locations = this.definitionsFor(symbol.name, uri)
      .filter((def) => def.builtin !== true || def.uri.startsWith("metta://"))
      .map((def) => Location.create(def.uri, cloneRange(def.selectionRange)));
    // Go-to-definition on a grounded atom also jumps across the language boundary to the TypeScript host
    // declaration (a registration site, or the ambient lib for a `js-atom` global).
    const binding = this.hostBindingFor(uri, position, symbol);
    if (binding?.definition) locations.push(binding.definition);
    return locations;
  }

  public implementation(uri: string, position: Position): Location[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol || symbol.kind === "variable") return [];
    const defs = this.definitionsFor(symbol.name, uri);
    const visible = this.visibleUris(uri);
    const locations: Location[] = [];
    const seen = new Set<string>();
    const push = (def: DefinitionRecord): void => {
      if (def.builtin === true && !def.uri.startsWith("metta://")) return;
      const loc = Location.create(def.uri, cloneRange(def.selectionRange));
      const key = locationKey(loc);
      if (seen.has(key)) return;
      seen.add(key);
      locations.push(loc);
    };

    for (const def of defs) {
      if (
        def.kind === "function" ||
        def.kind === "macro" ||
        def.kind === "constant" ||
        def.kind === "binding"
      )
        push(def);
    }

    const typeLike = defs.some((def) => def.kind === "type") || /^[A-Z]/.test(symbol.name);
    if (typeLike) {
      for (const group of this.definitionsByName.values()) {
        for (const def of group) {
          if (!visible.has(def.uri)) continue;
          const sig = def.signature;
          if (!sig) continue;
          if (sig.returns === symbol.name || sig.params.includes(symbol.name)) push(def);
        }
      }
    }

    return locations.sort(compareLocations);
  }

  public references(uri: string, position: Position, includeDeclaration = true): Location[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol) return [];
    if (symbol.kind === "variable")
      return this.variableReferences(uri, symbol.name, position, includeDeclaration);
    const visible = this.visibleUris(uri);
    const refs: Location[] = [];
    const seen = new Set<string>();
    if (includeDeclaration) {
      for (const def of this.definitionsFor(symbol.name, uri)) {
        const loc = Location.create(def.uri, cloneRange(def.selectionRange));
        const key = locationKey(loc);
        if (!seen.has(key)) {
          seen.add(key);
          refs.push(loc);
        }
      }
    }
    for (const ref of this.referencesByName.get(symbol.name) ?? []) {
      if (!visible.has(ref.uri) && ref.uri !== normalizeUri(uri)) continue;
      const loc = Location.create(ref.uri, cloneRange(ref.range));
      const key = locationKey(loc);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(loc);
    }
    return refs.sort(compareLocations);
  }

  // The ranges of a logic variable's occurrences within its rule, so the editor renames them together as the
  // user types. Only variables link, and only when the variable occurs more than once (there is nothing to
  // keep in sync otherwise). Single-document, since a variable's scope never crosses files.
  public linkedEditingRanges(uri: string, position: Position): { ranges: Range[] } | null {
    const symbol = this.symbolAt(uri, position);
    if (!symbol || symbol.kind !== "variable") return null;
    const normalized = normalizeUri(uri);
    const ranges = this.variableReferences(uri, symbol.name, position, true)
      .filter((location) => normalizeUri(location.uri) === normalized)
      .map((location) => cloneRange(location.range));
    return ranges.length > 1 ? { ranges } : null;
  }

  private variableReferences(
    uri: string,
    name: string,
    position: Position,
    includeDeclaration: boolean,
  ): Location[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const scope = index.locals
      .filter((local) => local.name === name && rangeContainsPosition(local.scopeRange, position))
      .sort((a, b) => rangeSize(a.scopeRange) - rangeSize(b.scopeRange))[0];
    const scopeRange =
      scope?.scopeRange ?? this.enclosingListRange(index, position) ?? fullRangeForText(index.text);
    const refs: Location[] = [];
    const seen = new Set<string>();
    if (includeDeclaration && scope) {
      const loc = Location.create(uri, cloneRange(scope.range));
      seen.add(locationKey(loc));
      refs.push(loc);
    }
    for (const ref of index.references) {
      if (ref.name !== name || ref.kind !== "variable-reference") continue;
      if (!rangeContainsPosition(scopeRange, ref.range.start)) continue;
      const loc = Location.create(uri, cloneRange(ref.range));
      const key = locationKey(loc);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(loc);
    }
    return refs.sort((a, b) => compareRange(a.range, b.range));
  }

  private enclosingListRange(index: DocumentIndex, position: Position): Range | null {
    const node = findNodeAtPosition(
      index.parsed.root,
      position,
      (candidate) => candidate.kind === "list",
    );
    return node?.range ?? null;
  }

  public declaration(uri: string, position: Position): Location[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol || symbol.kind === "variable") return [];
    const visible = this.visibleUris(uri);
    const locations: Location[] = [];
    const seen = new Set<string>();
    for (const group of this.definitionsByName.values()) {
      for (const def of group) {
        if (def.name !== symbol.name) continue;
        if (!visible.has(def.uri) && def.uri !== normalizeUri(uri)) continue;
        if (def.kind !== "type") continue;
        const loc = Location.create(def.uri, cloneRange(def.selectionRange));
        const key = locationKey(loc);
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(loc);
      }
    }
    return locations.sort(compareLocations);
  }

  public typeDefinition(uri: string, position: Position): Location[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol || symbol.kind === "variable") return [];
    const locations: Location[] = [];
    const seen = new Set<string>();
    const addByName = (name: string): void => {
      for (const def of this.definitionsFor(name, uri, false)) {
        if (def.kind !== "type") continue;
        const loc = Location.create(def.uri, cloneRange(def.selectionRange));
        const key = locationKey(loc);
        if (seen.has(key)) continue;
        seen.add(key);
        locations.push(loc);
      }
    };
    addByName(symbol.name);
    for (const def of this.definitionsFor(symbol.name, uri)) {
      for (const typeName of def.signature?.params ?? []) addByName(typeName);
      if (def.signature?.returns) addByName(def.signature.returns);
    }
    return locations.sort(compareLocations);
  }

  public documentHighlights(uri: string, position: Position): DocumentHighlight[] {
    const index = this.ensureIndexed(uri);
    const symbol = this.symbolAt(uri, position);
    if (!index || !symbol) return [];
    const locations = this.references(uri, position, true).filter(
      (loc) => normalizeUri(loc.uri) === normalizeUri(uri),
    );
    const definitionKeys = new Set(
      index.definitions
        .filter((def) => def.name === symbol.name)
        .map((def) => rangeKey(def.selectionRange)),
    );
    return locations.map((loc) =>
      DocumentHighlight.create(
        cloneRange(loc.range),
        definitionKeys.has(rangeKey(loc.range))
          ? DocumentHighlightKind.Write
          : DocumentHighlightKind.Read,
      ),
    );
  }

  public documentLinks(uri: string): DocumentLink[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    return index.imports
      .filter((imp) => Boolean(imp.resolvedUri))
      .map((imp) => DocumentLink.create(cloneRange(imp.pathRange), imp.resolvedUri));
  }

  public selectionRanges(uri: string, positions: readonly Position[]): SelectionRange[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const build = (position: Position): SelectionRange => {
      const nodes: AstNode[] = [];
      walkAst(index.parsed.root, (node) => {
        if (rangeContainsPosition(node.range, position)) nodes.push(node);
      });
      nodes.sort((a, b) => rangeLengthScore(a.range) - rangeLengthScore(b.range));
      let parent: SelectionRange | undefined;
      for (const node of nodes) {
        parent = SelectionRange.create(cloneRange(node.range), parent);
      }
      return parent ?? SelectionRange.create({ start: position, end: position });
    };
    return positions.map(build);
  }

  public explainForm(
    uri: string,
    position: Position,
  ): { range: Range; text: string; notation?: string; symbol?: string; arity?: number } | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const node =
      findNodeAtPosition(index.parsed.root, position, (candidate) => candidate.kind === "list") ??
      findNodeAtPosition(index.parsed.root, position);
    if (!node) return null;
    if (node.kind === "comment") return null;
    const notation = toMixfix(this.sourceForRange(uri, node.range));
    if (node.kind === "list") {
      const children = semanticChildren(node);
      const head = namedChildText(children[0]) ?? "<expression>";
      const arity = Math.max(0, children.length - 1);
      const defs = this.definitionsFor(head, uri);
      const signature = defs[0]?.signature?.raw ?? defs[0]?.detail;
      const role = isDefinitionHead(head)
        ? "definition/declaration form"
        : isImportHead(head)
          ? "import form"
          : isKeyword(head)
            ? "special form"
            : "call/expression";
      const text = [
        `${head}: ${role}`,
        `Notation: ${notation}`,
        `Arity: ${arity}`,
        signature ? `Signature: ${signature}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
      return { range: cloneRange(node.range), text, notation, symbol: head, arity };
    }
    return { range: cloneRange(node.range), text: `${node.text}: ${node.kind}`, notation };
  }

  public prepareRename(uri: string, position: Position): RenameTarget | null {
    const symbol = this.symbolAt(uri, position);
    if (!symbol) return null;
    if (symbol.token.type === "string" || symbol.token.type === "number") return null;
    if (isKeyword(symbol.name) || OPERATORS.has(symbol.name)) return null;
    const refs = this.references(uri, position, true);
    if (refs.length === 0) return null;
    return { name: symbol.name, range: symbol.token.range, references: refs, kind: symbol.kind };
  }

  public rename(uri: string, position: Position, newName: string): WorkspaceEdit | null {
    const target = this.prepareRename(uri, position);
    if (!target) return null;
    if (!this.isValidRename(target.name, newName, target.kind)) return null;
    const changes: Record<string, TextEdit[]> = {};
    for (const ref of target.references) {
      const key = normalizeUri(ref.uri);
      const edits = changes[key] ?? [];
      edits.push(TextEdit.replace(ref.range, newName));
      changes[key] = edits;
    }
    for (const edits of Object.values(changes))
      edits.sort((a, b) => compareRange(a.range, b.range));
    return { changes };
  }

  // Keep import!/include references valid when files are renamed: for each rename, rewrite the module-name
  // segment of every import that resolved to the old file. Directory/main imports (whose name segment is not
  // the renamed module) are left alone. Advertised as workspace/willRenameFiles, so the edits land as part of
  // the rename.
  public renameFileImportEdits(
    renames: readonly { readonly oldUri: string; readonly newUri: string }[],
  ): WorkspaceEdit | null {
    const changes: Record<string, TextEdit[]> = {};
    for (const rename of renames) {
      const oldPath = this.uriToPath(rename.oldUri);
      const newPath = this.uriToPath(rename.newUri);
      if (oldPath === null || newPath === null || !isMettaFile(oldPath)) continue;
      const oldBase = path.basename(oldPath, path.extname(oldPath));
      const newBase = path.basename(newPath, path.extname(newPath));
      if (oldBase === newBase) continue;
      const oldResolved = normalizeUri(rename.oldUri);
      for (const [docUri, index] of this.documents) {
        for (const imp of index.imports) {
          if (imp.resolvedUri === undefined || normalizeUri(imp.resolvedUri) !== oldResolved)
            continue;
          const rewritten = rewriteImportName(imp.rawPath, oldBase, newBase);
          if (rewritten === null) continue;
          const edits = changes[docUri] ?? [];
          edits.push(TextEdit.replace(imp.pathRange, imp.quoted ? `"${rewritten}"` : rewritten));
          changes[docUri] = edits;
        }
      }
    }
    for (const edits of Object.values(changes))
      edits.sort((a, b) => compareRange(a.range, b.range));
    return Object.keys(changes).length > 0 ? { changes } : null;
  }

  private isValidRename(
    oldName: string,
    newName: string,
    kind: DefinitionKind | "variable" | "unknown",
  ): boolean {
    if (!newName || /[\s()[\]{}";]/.test(newName)) return false;
    if (kind === "variable" || oldName.startsWith("$"))
      return newName.startsWith("$") && newName.length > 1;
    if (oldName.startsWith("&")) return newName.startsWith("&") && newName.length > 1;
    return !newName.startsWith("$");
  }

  public documentSymbols(uri: string): DocumentSymbol[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    // Group a symbol's definitions — its type signature and every rewrite clause — under one outline entry,
    // so `double` appears once and expands to show its signature and each `=` clause, instead of repeating
    // the name across sibling rows. A symbol with a single definition stays a flat leaf. Definitions are
    // sorted by range first, so both the top-level entries and each group's children come out in source
    // order and the first definition of a group anchors its outline entry.
    const groups = new Map<string, DefinitionRecord[]>();
    for (const def of [...index.definitions].sort((a, b) => compareRange(a.range, b.range))) {
      const existing = groups.get(def.name);
      if (existing) existing.push(def);
      else groups.set(def.name, [def]);
    }
    // `Map` preserves insertion order, so groups come out in the source order of each symbol's first
    // definition.
    const symbols: DocumentSymbol[] = [];
    for (const defs of groups.values()) {
      const first = defs[0];
      if (!first) continue;
      if (defs.length === 1) {
        symbols.push(
          DocumentSymbol.create(
            first.name,
            first.detail ?? first.kind,
            symbolKindForDefinition(first.kind),
            cloneRange(first.range),
            cloneRange(first.selectionRange),
            [],
          ),
        );
        continue;
      }
      const children = defs.map((def) =>
        DocumentSymbol.create(
          def.detail ?? def.name,
          def.kind,
          symbolKindForDefinition(def.kind),
          cloneRange(def.range),
          cloneRange(def.selectionRange),
          [],
        ),
      );
      symbols.push(
        DocumentSymbol.create(
          first.name,
          first.detail ?? `${defs.length} definitions`,
          symbolKindForDefinition(representativeKind(defs)),
          unionDefinitionRange(defs),
          cloneRange(first.selectionRange),
          children,
        ),
      );
    }
    return symbols;
  }

  public workspaceSymbols(
    query: string,
    options: WorkspaceSymbolOptions = {},
  ): SymbolInformation[] {
    const normalizedQuery = query.trim().toLowerCase();
    const roots = options.roots ?? this.getWorkspaceRoots();
    const rootMembership = new Map<string, boolean>();
    const withinRoots = (uri: string): boolean => {
      if (roots.length === 0) return true;
      const cached = rootMembership.get(uri);
      if (cached !== undefined) return cached;
      const included = this.uriWithinRoots(uri, roots);
      rootMembership.set(uri, included);
      return included;
    };
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0
        ? Math.trunc(options.limit)
        : 500;
    const symbols: SymbolInformation[] = [];
    for (const defs of this.definitionsByName.values()) {
      for (const def of defs) {
        if (normalizedQuery && !def.name.toLowerCase().includes(normalizedQuery)) continue;
        if (!withinRoots(def.uri)) continue;
        symbols.push(
          SymbolInformation.create(
            def.name,
            symbolKindForDefinition(def.kind),
            cloneRange(def.selectionRange),
            def.uri,
            def.kind,
          ),
        );
        if (symbols.length >= limit) return symbols;
      }
    }
    return symbols;
  }

  public completions(
    uri: string,
    position: Position,
    settings: CompletionSettings = this.settings.completion,
  ): CompletionItem[] {
    const index = this.ensureIndexed(uri);
    const prefix = index ? this.prefixAt(index, position) : "";
    const lowerPrefix = prefix.toLowerCase();
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const push = (item: CompletionItem): void => {
      const key = item.label;
      if (seen.has(key)) return;
      if (lowerPrefix && !item.label.toLowerCase().startsWith(lowerPrefix)) return;
      seen.add(key);
      items.push(item);
    };

    // In a lint.metta, offer the rule-DSL vocabulary (lint-rule, pattern, message, …) so authoring a rule is
    // guided the same way as ordinary MeTTa. The push helper prefix-filters, so `(lint-` narrows to the two.
    if (isLintConfigFile(normalizeUri(uri))) {
      for (const [keyword, doc] of LINT_DSL_HOVER)
        push({
          label: keyword,
          kind: CompletionItemKind.Keyword,
          documentation: { kind: MarkupKind.Markdown, value: doc },
        });
    }

    for (const builtin of BUILTINS) {
      push({
        label: builtin.name,
        kind:
          builtin.kind === "macro"
            ? CompletionItemKind.Keyword
            : builtin.kind === "type"
              ? CompletionItemKind.TypeParameter
              : CompletionItemKind.Function,
        detail: builtin.signatures[0],
        documentation: { kind: MarkupKind.Markdown, value: builtin.documentation },
        insertText: builtin.insertText ?? builtin.name,
        insertTextFormat:
          builtin.insertText?.includes("${") === true
            ? InsertTextFormat.Snippet
            : InsertTextFormat.PlainText,
        data: { origin: "builtin", name: builtin.name },
      });
    }
    for (const typeName of STANDARD_TYPES) {
      push({
        label: typeName,
        kind: CompletionItemKind.TypeParameter,
        detail: "standard MeTTa type",
        data: { origin: "builtin", name: typeName },
      });
    }
    for (const def of this.allVisibleDefinitions(uri, false)) {
      push({
        label: def.name,
        kind: completionKindForDefinition(def.kind),
        detail: def.detail ?? def.signature?.raw ?? def.kind,
        documentation: def.documentation
          ? { kind: MarkupKind.Markdown, value: def.documentation }
          : undefined,
        insertText:
          def.arity !== undefined && def.kind === "function"
            ? completionSnippetForDefinition(def)
            : def.name,
        insertTextFormat:
          def.arity !== undefined && def.kind === "function"
            ? InsertTextFormat.Snippet
            : InsertTextFormat.PlainText,
        data: { origin: "workspace", name: def.name, uri: def.uri },
      });
    }
    if (settings.autoImports && index) {
      const visible = this.visibleUris(uri);
      for (const def of this.allDefinitions(false)) {
        if (visible.has(def.uri) || def.uri === index.uri) continue;
        const importPath = this.importPathFor(uri, def.uri);
        if (!importPath) continue;
        push({
          label: def.name,
          kind: completionKindForDefinition(def.kind),
          detail: `auto-import from ${importPath}`,
          additionalTextEdits: this.importTextEdits(index, importPath),
          data: { origin: "import", name: def.name, uri: def.uri },
        });
      }
    }
    if (settings.includeSnippets) {
      for (const snippet of snippetCompletions()) push(snippet);
    }
    return items.slice(0, 500);
  }

  public resolveCompletion(item: CompletionItem): CompletionItem {
    const data = item.data as { name?: string; origin?: string; uri?: string } | undefined;
    if (!data?.name) return item;
    const builtin = BUILTIN_BY_NAME.get(data.name);
    if (builtin) {
      // Interpreter-derived entries carry no static prose; get-doc supplies it live (cached, on demand).
      const doc = builtin.documentation || this.liveDoc(data.uri ?? "", data.name) || "";
      const signature =
        builtin.signatures.length > 0 ? markdownCode("metta", builtin.signatures.join("\n")) : "";
      return {
        ...item,
        documentation: { kind: MarkupKind.Markdown, value: `${doc}${signature}` },
      };
    }
    const defs = this.definitionsFor(data.name, data.uri ?? null, false);
    const def = defs[0];
    if (!def) return item;
    return {
      ...item,
      documentation: { kind: MarkupKind.Markdown, value: this.definitionMarkdown(def) },
    };
  }

  private prefixAt(index: DocumentIndex, position: Position): string {
    const offset = offsetAt(position, index.parsed.lineOffsets, index.text.length);
    let start = offset;
    while (start > 0 && /[^\s()[\]{}";]/.test(index.text[start - 1] ?? "")) start--;
    return index.text.slice(start, offset);
  }

  private importPathFor(sourceUri: string, targetUri: string): string | null {
    const sourcePath = this.uriToPath(sourceUri);
    const targetPath = this.uriToPath(targetUri);
    if (!sourcePath || !targetPath) return null;
    let rel = path.relative(path.dirname(sourcePath), targetPath).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return rel;
  }

  private importTextEdits(index: DocumentIndex, importPath: string): TextEdit[] {
    if (index.imports.some((imp) => imp.rawPath === importPath)) return [];
    const insertLine =
      index.imports.length > 0 ? Math.max(...index.imports.map((imp) => imp.range.end.line)) : 0;
    const text = `(import! &self "${importPath}")\n`;
    return [TextEdit.insert({ line: insertLine, character: 0 }, text)];
  }

  // A quick-fix edit that imports a built-in module (json/catalog/fileio). A bang form, so the module
  // actually loads — declarationContext runs a built-in-module import for get-type/get-doc.
  private builtinModuleImportEdits(index: DocumentIndex, module: string): TextEdit[] {
    if (index.imports.some((imp) => imp.rawPath === module)) return [];
    const insertLine =
      index.imports.length > 0 ? Math.max(...index.imports.map((imp) => imp.range.end.line)) : 0;
    return [TextEdit.insert({ line: insertLine, character: 0 }, `!(import! &self ${module})\n`)];
  }

  // The import path of a workspace file that defines `name` but does not currently reach `uri`, or undefined.
  // Turns an unknown head that is defined in another file into a precise "import it from there" hint.
  private crossFileImportFor(name: string, uri: string): string | undefined {
    for (const def of this.definitionsFor(name, uri, false)) {
      if (def.builtin === true || def.uri === uri) continue;
      const importPath = this.importPathFor(uri, def.uri);
      if (importPath !== null) return importPath;
    }
    return undefined;
  }

  private definitionMarkdown(def: DefinitionRecord): string {
    const lines = [`**${def.name}** — ${def.kind}`];
    if (def.signature?.raw) lines.push(markdownCode("metta", def.signature.raw));
    if (def.documentation) lines.push(def.documentation);
    lines.push(`Defined in: ${relativeDisplayPath(def.uri, this.getWorkspaceRoots())}`);
    return lines.join("\n\n");
  }

  public signatureHelp(uri: string, position: Position): SignatureHelp | null {
    const active = this.activeCall(uri, position);
    if (!active) return null;
    const defs = this.definitionsFor(active.call.name, uri);
    const signatures = defs
      .map((def) => this.signatureInfoForDefinition(def))
      .filter((signature): signature is SignatureInformation => signature !== null);
    if (signatures.length === 0) return null;
    return { signatures, activeSignature: 0, activeParameter: Math.max(0, active.activeParameter) };
  }

  private signatureInfoForDefinition(def: DefinitionRecord): SignatureInformation | null {
    if (def.signature) {
      return SignatureInformation.create(
        def.signature.raw,
        def.documentation,
        ...def.signature.params.map((param) => ParameterInformation.create(param)),
      );
    }
    if (def.arity !== undefined) {
      const params = Array.from(
        { length: def.arity },
        (_, index) => ARG_LABELS[index] ?? `$arg${index + 1}`,
      );
      return SignatureInformation.create(
        callLabel(def.name, def.arity),
        def.documentation,
        ...params.map((param) => ParameterInformation.create(param)),
      );
    }
    const builtin = BUILTIN_BY_NAME.get(def.name);
    if (builtin?.signatures[0]) {
      return SignatureInformation.create(builtin.signatures[0], builtin.documentation);
    }
    return null;
  }

  public activeCall(uri: string, position: Position): ActiveCallInfo | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const offset = offsetAt(position, index.parsed.lineOffsets, index.text.length);
    const enclosing = index.calls
      .filter((call) => call.node.offsetStart <= offset && offset <= call.node.offsetEnd)
      .sort(
        (a, b) => a.node.offsetEnd - a.node.offsetStart - (b.node.offsetEnd - b.node.offsetStart),
      )[0];
    if (!enclosing) return null;
    let activeParameter = 0;
    for (let i = 0; i < enclosing.args.length; i++) {
      const arg = enclosing.args[i];
      if (!arg) continue;
      if (offset >= arg.offsetStart) activeParameter = i;
      if (offset <= arg.offsetEnd) break;
    }
    return { call: enclosing, activeParameter };
  }

  public formatDocument(uri: string): TextEdit[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const formatted = formatMetta(index.text, this.formatOptionsFor(uri));
    if (formatted === index.text) return [];
    return [TextEdit.replace(fullRangeForText(index.text), formatted)];
  }

  public formatRange(uri: string, range: Range): TextEdit[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const offsets = index.parsed.lineOffsets;
    const start = offsetAt(range.start, offsets, index.text.length);
    const end = offsetAt(range.end, offsets, index.text.length);
    const original = index.text.slice(start, end);
    const formatted = formatMetta(original, this.formatOptionsFor(uri));
    if (formatted === original) return [];
    return [TextEdit.replace(range, formatted)];
  }

  public sourceForRange(uri: string, range?: Range): string {
    const index = this.ensureIndexed(uri);
    if (!index) return "";
    if (!range) return index.text;
    const start = offsetAt(range.start, index.parsed.lineOffsets, index.text.length);
    const end = offsetAt(range.end, index.parsed.lineOffsets, index.text.length);
    return index.text.slice(Math.max(0, start), Math.max(0, end));
  }

  public evaluationSource(uri: string, range?: Range, includePriorDefinitions = true): string {
    const index = this.ensureIndexed(uri);
    if (!index) return "";
    if (!range) return index.text;
    // A bare runnable selection becomes a `!` query here, before context forms are prepended: wrapping
    // afterwards would see a multi-form source and give up, and an unbanged form would only be added to
    // the space instead of evaluated.
    const selected = wrapBareExpression(this.sourceForRange(uri, range).trim());
    if (!includePriorDefinitions || selected.length === 0) return selected;
    const startOffset = offsetAt(range.start, index.parsed.lineOffsets, index.text.length);
    // Prepend the earlier forms the selection needs to mean what it means in the file: definitions and
    // type declarations, plus import!/include/bind!/pragma! directives kept banged exactly as written,
    // so a range run resolves imports and obeys pragmas the way a whole-file run does.
    const top = semanticChildren(index.parsed.root);
    const prefixForms: string[] = [];
    for (let i = 0; i < top.length; i += 1) {
      const child = top[i];
      if (!child || child.kind !== "list" || child.offsetEnd > startOffset) continue;
      const head = headSymbol(child);
      if (head === null || !EVALUATION_CONTEXT_HEADS.has(head)) continue;
      const previous = top[i - 1];
      const from =
        previous?.kind === "symbol" && previous.text === "!"
          ? previous.offsetStart
          : child.offsetStart;
      prefixForms.push(index.text.slice(from, child.offsetEnd));
    }
    return [...prefixForms, selected].filter((part) => part.trim().length > 0).join("\n");
  }

  public importSourceMap(uri: string): Record<string, string> {
    const index = this.ensureIndexed(uri);
    if (!index) return {};
    const imports: Record<string, string> = {};
    for (const imp of index.imports) {
      if (!imp.resolvedUri) continue;
      const targetPath = this.uriToPath(imp.resolvedUri);
      if (targetPath !== null && !isMettaFile(targetPath)) continue;
      const target = this.ensureIndexed(imp.resolvedUri);
      if (!target) continue;
      const raw = stripQuotes(imp.rawPath);
      const names = new Set<string>([imp.rawPath, raw]);
      if (targetPath) {
        names.add(path.basename(targetPath));
        names.add(path.basename(targetPath, path.extname(targetPath)));
      }
      for (const name of names) {
        if (name.length > 0) imports[name] = target.text;
      }
    }
    return imports;
  }

  public importPathMap(uri: string): Record<string, string> {
    const index = this.ensureIndexed(uri);
    if (!index) return {};
    const imports: Record<string, string> = {};
    for (const imp of index.imports) {
      if (!imp.resolvedUri) continue;
      const targetPath = this.uriToPath(imp.resolvedUri);
      if (targetPath === null) continue;
      const raw = stripQuotes(imp.rawPath);
      const names = new Set<string>([imp.rawPath, raw, path.basename(targetPath)]);
      names.add(path.basename(targetPath, path.extname(targetPath)));
      for (const name of names) {
        if (name.length > 0) imports[name] = targetPath;
      }
    }
    return imports;
  }

  public organizeImports(uri: string): TextEdit[] {
    const index = this.ensureIndexed(uri);
    if (!index || index.imports.length === 0) return [];
    const importsByLine = new Map<number, ImportRecord[]>();
    for (const imp of index.imports) {
      const line = imp.range.start.line;
      const entries = importsByLine.get(line) ?? [];
      entries.push(imp);
      importsByLine.set(line, entries);
    }
    if ([...importsByLine.values()].some((imports) => imports.length !== 1)) return [];
    const startLine = Math.min(...importsByLine.keys());
    const endLine = Math.max(...importsByLine.keys());
    for (let line = startLine; line <= endLine; line++) {
      const imports = importsByLine.get(line);
      if (imports === undefined || !lineHasSingleImportForm(fullLineText(index.text, line)))
        return [];
    }
    const sortedLines = `${[...index.imports]
      .sort((a, b) => {
        const byPath = a.rawPath.localeCompare(b.rawPath);
        return byPath !== 0
          ? byPath
          : (a.targetSpace ?? "&self").localeCompare(b.targetSpace ?? "&self");
      })
      .map((imp) => imp.lineText.trim())
      .join("\n")}\n`;
    const range = lineRange(index.text, startLine, endLine);
    const current = index.text.slice(
      offsetAt(range.start, index.parsed.lineOffsets),
      offsetAt(range.end, index.parsed.lineOffsets, index.text.length),
    );
    if (current === sortedLines) return [];
    return [TextEdit.replace(range, sortedLines)];
  }

  // Offset spans of the top-level forms Run can execute, in document order: a `!` marker with the form
  // it bangs, a fused !word query, or a bare list whose head is runnable (evaluationSource wraps it into
  // a `!` query when run). Definitions and directives add to the space rather than reduce, so they are
  // not runnable.
  private runnableFormSpans(index: DocumentIndex): { start: number; end: number }[] {
    const spans: { start: number; end: number }[] = [];
    const top = semanticChildren(index.parsed.root);
    for (let i = 0; i < top.length; i += 1) {
      const child = top[i];
      if (!child) continue;
      if (child.kind === "symbol" && child.text === "!") {
        const next = top[i + 1];
        if (next) {
          spans.push({ start: child.offsetStart, end: next.offsetEnd });
          i += 1;
        }
        continue;
      }
      if (child.kind === "symbol" && child.text.length > 1 && child.text.startsWith("!")) {
        spans.push({ start: child.offsetStart, end: child.offsetEnd });
        continue;
      }
      if (child.kind === "list" && isRunnableHead(headSymbol(child))) {
        spans.push({ start: child.offsetStart, end: child.offsetEnd });
      }
    }
    return spans;
  }

  private runnableFormRanges(index: DocumentIndex): Range[] {
    return this.runnableFormSpans(index).map((span) =>
      rangeFromOffsets(span.start, span.end, index.parsed.lineOffsets),
    );
  }

  // The query the visualise surface reduces when none is given: the file's last runnable form (its
  // final `!` query, or the trailing bare call) without the bang, since the whole source already
  // supplies the definitions.
  public executableQuery(uri: string, range?: Range): string | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const spans = this.runnableFormSpans(index);
    const span =
      range === undefined
        ? spans.at(-1)
        : spans.find((candidate) =>
            rangeIntersects(
              rangeFromOffsets(candidate.start, candidate.end, index.parsed.lineOffsets),
              range,
            ),
          );
    if (!span) return null;
    return index.text.slice(span.start, span.end).replace(/^!\s*/, "");
  }

  // Pseudocode mode: a code lens above each top-level form rendering it in mixfix notation, so a reader
  // sees the meaning line by line. The lens command reuses metta.explainForm (a fuller reading on click).
  // Off unless the setting is on; the lens sits at the form start, so it renders left of the run lens.
  private pseudocodeLenses(index: DocumentIndex): CodeLens[] {
    if (!this.settings.pseudocode.enabled) return [];
    const lenses: CodeLens[] = [];
    const top = semanticChildren(index.parsed.root);
    for (let i = 0; i < top.length; i += 1) {
      const child = top[i];
      if (!child || child.kind === "comment") continue;
      // A standalone `!` marker precedes its form; render the pseudocode of the form it bangs, but anchor
      // the lens at the marker so it starts at column 0, left of the run lens on the same line.
      const form = child.kind === "symbol" && child.text === "!" ? top[++i] : child;
      if (!form) continue;
      const pseudo = toMixfix(index.text.slice(form.offsetStart, form.offsetEnd)).trim();
      if (pseudo.length === 0) continue;
      const formRange = rangeFromOffsets(
        form.offsetStart,
        form.offsetEnd,
        index.parsed.lineOffsets,
      );
      lenses.push({
        range: rangeFromOffsets(child.offsetStart, form.offsetEnd, index.parsed.lineOffsets),
        command: Command.create(`≡ ${pseudo}`, "metta.explainForm", {
          uri: index.uri,
          position: cloneRange(formRange).start,
        }),
      });
    }
    return lenses;
  }

  public codeLenses(uri: string): CodeLens[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const lenses: CodeLens[] = this.pseudocodeLenses(index);
    for (const runRange of this.runnableFormRanges(index)) {
      lenses.push({
        range: cloneRange(runRange),
        command: Command.create("▶ Run", "metta.run", {
          uri: index.uri,
          range: cloneRange(runRange),
        }),
      });
      lenses.push({
        range: cloneRange(runRange),
        command: Command.create("↝ Trace", "metta.trace", {
          uri: index.uri,
          range: cloneRange(runRange),
        }),
      });
    }
    for (const def of [...index.definitions].sort((a, b) =>
      compareRange(a.selectionRange, b.selectionRange),
    )) {
      const references = this.references(index.uri, def.selectionRange.start, false);
      lenses.push({
        range: cloneRange(def.selectionRange),
        command: Command.create(
          `${references.length} reference${references.length === 1 ? "" : "s"}`,
          "metta.showReferences",
          { uri: index.uri, position: def.selectionRange.start, locations: references },
        ),
      });
    }
    return lenses.slice(0, 1000);
  }

  public explainAt(
    uri: string,
    position: Position,
  ): { readonly range: Range; readonly text: string; readonly kind: string } | null {
    const index = this.ensureIndexed(uri);
    if (!index) return null;
    const node =
      findNodeAtPosition(
        index.parsed.root,
        position,
        (candidate) => candidate.kind !== "comment",
      ) ?? index.parsed.root;
    const form = node.kind === "list" ? node : node.parent?.kind === "list" ? node.parent : node;
    const children = form.kind === "list" ? semanticChildren(form) : [];
    const head = form.kind === "list" ? headSymbol(form) : null;
    const render = (n: AstNode | undefined): string =>
      n ? n.text.replaceAll(/\s+/g, " ").trim() : "<missing>";
    let text: string;
    let kind: string = form.kind;
    switch (head ?? "") {
      case "=":
        text = `Rewrite rule: when ${render(children[1])} matches, reduce it to ${render(children[2])}.`;
        kind = "definition";
        break;
      case ":":
        text = `Type declaration: ${render(children[1])} has type ${render(children[2])}.`;
        kind = "type-declaration";
        break;
      case "if":
        text = `Conditional: evaluate ${render(children[1])}; choose ${render(children[2])} when true, otherwise ${render(children[3])}.`;
        kind = "control-flow";
        break;
      case "let":
      case "let*":
        text = `Binding form: bind ${render(children[1])} from ${render(children[2])}, then evaluate ${render(children[3])}.`;
        kind = "binding";
        break;
      case "match":
        text = `Pattern match: search ${render(children[1])} for ${render(children[2])}, then return ${render(children[3])}.`;
        kind = "pattern-match";
        break;
      case "import!":
        text = `Import form: load ${render(children[children.length - 1])} into the visible MeTTa environment.`;
        kind = "import";
        break;
      default:
        if (form.kind === "list" && head) {
          text = `Function call: apply ${head} to ${Math.max(0, children.length - 1)} argument${children.length === 2 ? "" : "s"}.`;
          kind = "call";
        } else if (form.kind === "variable") {
          text = `Logic variable ${form.text}: binds during matching or unification.`;
          kind = "variable";
        } else {
          text = `Atom ${render(form)}.`;
        }
    }
    return { range: cloneRange(form.range), text, kind };
  }

  public codeActions(uri: string, range: Range): CodeAction[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const actions: CodeAction[] = [];
    const importEdits = this.organizeImports(uri);
    if (importEdits.length > 0) {
      actions.push({
        title: codeActionTitle.organizeImports,
        kind: CodeActionKind.SourceOrganizeImports,
        edit: { changes: { [index.uri]: importEdits } },
      });
    }
    // Lint autofixes: a rule finding with a rewrite that overlaps the requested range becomes a QuickFix.
    const lintOffsets = index.parsed.lineOffsets;
    for (const finding of this.lintFindings(uri)) {
      if (finding.fix === undefined) continue;
      const fixRange = rangeFromOffsets(finding.fix.start, finding.fix.end, lintOffsets);
      if (!rangeIntersects(fixRange, range)) continue;
      actions.push({
        title: codeActionTitle.applyLintFix(finding.ruleId),
        kind: CodeActionKind.QuickFix,
        diagnostics: [lintFindingToDiagnostic(finding, lintOffsets)],
        isPreferred: true,
        edit: { changes: { [index.uri]: [TextEdit.replace(fixRange, finding.fix.newText)] } },
      });
    }
    const suppressSeen = new Set<string>();
    for (const diagnostic of this.validate(uri)) {
      if (!rangeIntersects(diagnostic.range, range)) continue;
      // Offer to silence any diagnostic inline: insert a `; @suppress <code>` above the line, which the
      // validate pass reads to drop this code here. Deduped per code+line so a code firing twice on one line
      // offers a single action.
      if (typeof diagnostic.code === "string") {
        const key = `${diagnostic.code}:${diagnostic.range.start.line}`;
        if (!suppressSeen.has(key)) {
          suppressSeen.add(key);
          actions.push({
            title: codeActionTitle.suppress(diagnostic.code),
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [index.uri]: [
                  TextEdit.insert(
                    { line: diagnostic.range.start.line, character: 0 },
                    `; @suppress ${diagnostic.code}\n`,
                  ),
                ],
              },
            },
          });
        }
      }
      if (
        diagnostic.code === "symbol.possibleTypo" ||
        diagnostic.code === "call.variableSlot" ||
        diagnostic.code === "space.unbound"
      ) {
        // The did-you-mean fix replaces the diagnostic's own range with the suggestion, reading both from the
        // diagnostic data. It covers a head-symbol typo, a variable slot missing its $ (x -> $x), and a
        // mis-cased space (&Self -> &self) — each diagnostic's range is exactly the token to replace.
        const data = diagnostic.data as { suggestion?: string; name?: string } | undefined;
        if (data?.suggestion !== undefined) {
          actions.push({
            title: codeActionTitle.applySuggestion(data.name ?? "", data.suggestion),
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: {
              changes: { [index.uri]: [TextEdit.replace(diagnostic.range, data.suggestion)] },
            },
          });
        }
      } else if (diagnostic.code === "symbol.needsImport") {
        // The head is exactly a name that an import would make available: a built-in module, or another
        // workspace file that already defines it. Offer the matching import as the fix.
        const data = diagnostic.data as
          | { module?: string; importPath?: string; name?: string }
          | undefined;
        if (data?.module !== undefined) {
          actions.push({
            title: codeActionTitle.importBuiltinModule(data.module),
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: { changes: { [index.uri]: this.builtinModuleImportEdits(index, data.module) } },
          });
        } else if (data?.importPath !== undefined) {
          actions.push({
            title: codeActionTitle.importSymbol(data.name ?? "", data.importPath),
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: { changes: { [index.uri]: this.importTextEdits(index, data.importPath) } },
          });
        }
      } else if (diagnostic.code === "import.notRun") {
        // Insert the leading ! so the import runs; the bang binds across whitespace, so the line start is safe.
        actions.push({
          title: codeActionTitle.runImport(),
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: { changes: { [index.uri]: [TextEdit.insert(diagnostic.range.start, "!")] } },
        });
      }
    }
    const symbol = this.symbolAt(uri, range.start);
    // Run is offered only on a runnable top-level form and executes exactly that form (bang-wrapped by
    // evaluationSource when bare); definitions and directives get no run action.
    const runRange = this.runnableFormRanges(index).find((candidate) =>
      rangeIntersects(candidate, range),
    );
    if (runRange) {
      actions.push(
        CodeAction.create(
          "Run",
          Command.create("Run", "metta.run", { uri: index.uri, range: cloneRange(runRange) }),
          CodeActionKind.Empty,
        ),
      );
    }
    const addType = this.addTypeDeclarationAction(index, range.start);
    if (addType) actions.push(addType);
    if (symbol?.kind === "variable") {
      actions.push(
        CodeAction.create(
          "Rename variable",
          Command.create("Rename Symbol", "editor.action.rename"),
          CodeActionKind.RefactorRewrite,
        ),
      );
    } else if (symbol && !isKeyword(symbol.name)) {
      actions.push(
        CodeAction.create(
          "Rename symbol",
          Command.create("Rename Symbol", "editor.action.rename"),
          CodeActionKind.RefactorRewrite,
        ),
      );
    }
    return actions;
  }

  // Suggest a type declaration for the untyped function definition at `position`. Declaring a function's
  // type lets the interpreter dispatch by type instead of trying every rule, so a typed function reduces
  // faster; this scaffolds the `(: name (-> ...))` above the definition. Parameter types are read from
  // literal arguments (a `0` argument types the slot Number) and left as a `$a` placeholder for a
  // variable, and the return type from the body's head signature; the user narrows the placeholders.
  private addTypeDeclarationAction(index: DocumentIndex, position: Position): CodeAction | null {
    const at = findNodeAtPosition(index.parsed.root, position, (node) => node.kind === "list");
    let form: AstNode | undefined = at ?? undefined;
    while (form && !(form.kind === "list" && headSymbol(form) === "=")) form = form.parent;
    if (!form) return null;
    const parts = semanticChildren(form);
    const lhs = parts[1];
    // Only a `(head args...)` left side is a function; `(= x 1)` is a constant, left to the user.
    if (!lhs || lhs.kind !== "list") return null;
    const lhsParts = semanticChildren(lhs);
    const head = lhsParts[0];
    if (!head || head.kind !== "symbol") return null;
    const name = head.text;
    // Already declared (a `(: name ...)` anywhere in scope): nothing to add.
    if (
      this.definitionsFor(name, index.uri).some(
        (def) => def.signature !== undefined || def.kind === "type",
      )
    )
      return null;
    const args = lhsParts.slice(1);
    if (args.length === 0) return null;
    const slot = (node: AstNode, i: number): string => {
      const inferred = inferAtomType(node);
      return inferred.confidence === "exact"
        ? inferred.name
        : `$${String.fromCharCode(97 + (i % 26))}`;
    };
    const params = args.map((arg, i) => slot(arg, i));
    const returnType = this.inferReturnType(parts[2], index.uri, index.text);
    const declaration = `(: ${name} (-> ${[...params, returnType].join(" ")}))\n`;
    return {
      title: codeActionTitle.addTypeDeclaration(name),
      kind: CodeActionKind.RefactorRewrite,
      edit: {
        changes: {
          [index.uri]: [
            TextEdit.insert({ line: form.range.start.line, character: 0 }, declaration),
          ],
        },
      },
    };
  }

  // The return type slot for a type-declaration scaffold: an exact literal types itself, otherwise the
  // interpreter's own get-type for the body in the file's context — which follows nested calls, if/let and the
  // head's declared return, subsuming the old head-only heuristic. A `$ret` placeholder when it has no single
  // concrete answer.
  private inferReturnType(body: AstNode | undefined, uri: string, text: string): string {
    if (!body) return "$ret";
    const inferred = inferAtomType(body);
    if (inferred.confidence === "exact") return inferred.name;
    const source = text.slice(body.offsetStart, body.offsetEnd);
    const live = this.liveType(uri, source);
    // A concrete answer beats the placeholder. Skip a bare type variable ($t) — get-type returns the
    // uninstantiated return variable for a polymorphic form like `if` rather than unifying the branches — and
    // skip unions and the top types it falls back to when it cannot pin the type down.
    if (
      live !== null &&
      !live.startsWith("$") &&
      !live.includes(" | ") &&
      live !== "%Undefined%" &&
      live !== "Atom"
    )
      return live;
    return "$ret";
  }

  // Full-document tokens, or only those intersecting `range` when a client requests the range variant (VS
  // Code asks for a range on large files before the full set is ready).
  public semanticTokens(uri: string, range?: Range): SemanticTokens {
    const index = this.ensureIndexed(uri);
    const builder = new SemanticTokensBuilder();
    if (!index) return builder.build();
    // Call-head and declaration ranges, precomputed once, let the per-token classifiers stay O(1) instead of
    // scanning index.calls / index.definitions for every token.
    const callHeads = new Set(index.calls.map((call) => rangeKey(call.nameRange)));
    const declarationRanges = new Set(index.definitions.map((def) => rangeKey(def.selectionRange)));
    const commentStarts = semanticCommentStartsByLine(index.parsed.tokens);
    for (const token of index.parsed.tokens) {
      const tokenRange = semanticRangeBeforeComment(token, commentStarts);
      if (tokenRange === null) continue;
      if (range !== undefined && !rangeIntersects(tokenRange, range)) continue;
      const tokenType = semanticTypeForToken(token, index, this, callHeads);
      if (tokenType === null) continue;
      const modifiers = semanticModifiersForToken(token, index, this, declarationRanges);
      builder.push(
        tokenRange.start.line,
        tokenRange.start.character,
        tokenRange.end.character - tokenRange.start.character,
        SEMANTIC_TOKEN_TYPE_INDEX.get(tokenType) ?? 0,
        modifierMask(modifiers),
      );
    }
    return builder.build();
  }

  public foldingRanges(uri: string): FoldingRange[] {
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const ranges: FoldingRange[] = [];
    walkAst(index.parsed.root, (node) => {
      if (node.kind !== "list") return;
      if (node.range.end.line > node.range.start.line) {
        ranges.push(
          FoldingRange.create(
            node.range.start.line,
            node.range.end.line,
            node.range.start.character,
            node.range.end.character,
            FoldingRangeKind.Region,
          ),
        );
      }
    });
    let commentStart: number | null = null;
    let previousLine = -2;
    for (const token of index.parsed.tokens) {
      if (token.type !== "comment") continue;
      if (commentStart === null || token.range.start.line !== previousLine + 1) {
        if (commentStart !== null && previousLine > commentStart)
          ranges.push(
            FoldingRange.create(
              commentStart,
              previousLine,
              undefined,
              undefined,
              FoldingRangeKind.Comment,
            ),
          );
        commentStart = token.range.start.line;
      }
      previousLine = token.range.start.line;
    }
    if (commentStart !== null && previousLine > commentStart)
      ranges.push(
        FoldingRange.create(
          commentStart,
          previousLine,
          undefined,
          undefined,
          FoldingRangeKind.Comment,
        ),
      );
    return ranges.slice(0, 5000);
  }

  public inlayHints(uri: string, range: Range): InlayHint[] {
    if (!this.settings.inlayHints.enabled) return [];
    const index = this.ensureIndexed(uri);
    if (!index) return [];
    const hints: InlayHint[] = [];
    for (const call of index.calls) {
      if (!rangeIntersects(call.node.range, range)) continue;
      const defs = this.definitionsFor(call.name, uri);
      const sig = defs.find((def) => def.signature?.params.length === call.args.length)?.signature;
      if (!sig) continue;
      call.args.forEach((arg, i) => {
        const label = sig.params[i];
        if (!label || label.startsWith("$") || label === "Atom" || label === "Any") return;
        hints.push({
          position: arg.range.start,
          label: `${label}:`,
          kind: InlayHintKind.Parameter,
          paddingRight: true,
        });
      });
      if (sig.returns && sig.returns !== "Atom" && sig.returns !== "Any") {
        hints.push({
          position: call.node.range.end,
          label: `: ${sig.returns}`,
          kind: InlayHintKind.Type,
          paddingLeft: true,
        });
      }
    }
    return hints;
  }

  public prepareCallHierarchy(uri: string, position: Position): CallHierarchyItem[] {
    const symbol = this.symbolAt(uri, position);
    if (!symbol) return [];
    const defs = this.definitionsFor(symbol.name, uri).filter(
      (def) => def.kind === "function" || def.kind === "macro" || def.kind === "constant",
    );
    return defs.map((def) => this.callHierarchyItem(def));
  }

  public incomingCalls(
    item: CallHierarchyItem,
  ): { from: CallHierarchyItem; fromRanges: Range[] }[] {
    const targetName = item.name;
    const results: { from: CallHierarchyItem; fromRanges: Range[] }[] = [];
    for (const index of this.documents.values()) {
      const byDefinition = new Map<string, Range[]>();
      for (const call of index.calls) {
        if (call.name !== targetName || !call.enclosingDefinition) continue;
        const ranges = byDefinition.get(call.enclosingDefinition) ?? [];
        ranges.push(call.nameRange);
        byDefinition.set(call.enclosingDefinition, ranges);
      }
      for (const [name, ranges] of byDefinition) {
        const def = index.definitions.find((candidate) => candidate.name === name);
        if (!def) continue;
        results.push({ from: this.callHierarchyItem(def), fromRanges: ranges });
      }
    }
    return results;
  }

  public outgoingCalls(item: CallHierarchyItem): { to: CallHierarchyItem; fromRanges: Range[] }[] {
    const index = this.ensureIndexed(item.uri);
    if (!index) return [];
    const def =
      index.definitions.find(
        (candidate) =>
          candidate.name === item.name &&
          rangeKey(candidate.selectionRange) === rangeKey(item.selectionRange),
      ) ?? index.definitions.find((candidate) => candidate.name === item.name);
    if (!def?.containerRange) return [];
    const byName = new Map<string, Range[]>();
    for (const call of index.calls) {
      if (!rangeContainsPosition(def.containerRange, call.nameRange.start)) continue;
      if (call.name === def.name || isKeyword(call.name)) continue;
      const ranges = byName.get(call.name) ?? [];
      ranges.push(call.nameRange);
      byName.set(call.name, ranges);
    }
    const results: { to: CallHierarchyItem; fromRanges: Range[] }[] = [];
    for (const [name, ranges] of byName) {
      const target =
        this.definitionsFor(name, item.uri)[0] ??
        builtinToDefinition(
          BUILTIN_BY_NAME.get(name) ?? {
            name,
            kind: "function",
            documentation: "",
            signatures: [],
          },
        );
      results.push({ to: this.callHierarchyItem(target), fromRanges: ranges });
    }
    return results;
  }

  private callHierarchyItem(def: DefinitionRecord): CallHierarchyItem {
    return {
      name: def.name,
      kind: symbolKindForDefinition(def.kind),
      uri: def.uri,
      range: cloneRange(def.range),
      selectionRange: cloneRange(def.selectionRange),
      detail: def.detail ?? def.kind,
      data: { name: def.name, uri: def.uri, range: def.selectionRange },
    };
  }
}

function rangeSize(range: Range): number {
  return (
    (range.end.line - range.start.line) * 100_000 + (range.end.character - range.start.character)
  );
}

// Argument positions each core form leaves as DATA (unreduced): the interpreter accepts an argument in a
// parameter typed Atom, Variable, or Expression unreduced, so a sub-expression there is a constructor,
// pattern, or held branch — not an evaluated call — and is not checked for undefined/arity/type. This is the
// exact rule the evaluator uses to decide what to reduce (eval.ts `argMask`: "a parameter typed Atom/Variable/
// Expression accepts its argument unreduced; every other position is [evaluated]"), read straight from the
// catalog's signatures. No evaluation, no side effects, and it never drifts from the meta-type declarations.
const DATA_ARG_POSITIONS: ReadonlyMap<string, ReadonlySet<number>> = (() => {
  const positions = new Map<string, Set<number>>();
  for (const [name, entry] of coreBuiltinTypes()) {
    const signature = signatureFromCoreType(name, entry.type);
    if (signature === undefined) continue;
    const data = new Set<number>();
    signature.params.forEach((param, index) => {
      if (param === "Atom" || param === "Variable" || param === "Expression") data.add(index);
    });
    if (data.size > 0) positions.set(name, data);
  }
  return positions;
})();

// Parameter positions each builtin types as `Variable` — a $-variable the form binds (map-atom/chain/foldl-atom
// $var slots), read straight from the catalog's signatures. A plain symbol in one of these positions type-checks
// (Hyperon accepts an untyped symbol) but fails to reduce at run time (NoReturn, verified against both Hyperon
// and metta-ts), so the diagnostic loop flags it — a static catch MeTTaTron makes and check-types cannot.
const VARIABLE_ARG_POSITIONS: ReadonlyMap<string, ReadonlySet<number>> = (() => {
  const positions = new Map<string, Set<number>>();
  for (const [name, entry] of coreBuiltinTypes()) {
    const signature = signatureFromCoreType(name, entry.type);
    if (signature === undefined) continue;
    const variablePositions = new Set<number>();
    signature.params.forEach((param, index) => {
      if (param === "Variable") variablePositions.add(index);
    });
    if (variablePositions.size > 0) positions.set(name, variablePositions);
  }
  return positions;
})();

// MeTTaTron's `suggest_variable_format`: a short lowercase symbol in a variable slot reads as a forgotten `$`,
// so suggest the $-prefixed form. Not for already-sigiled names, operators, or long/capitalized identifiers.
function variableFormatSuggestion(text: string): string | undefined {
  if (text.length === 0 || text.startsWith("$") || text.startsWith("&") || text.startsWith("'"))
    return undefined;
  if (text.includes("(") || text.includes(")")) return undefined;
  const first = text[0];
  if (first !== undefined && first >= "a" && first <= "z" && text.length <= 10) return `$${text}`;
  return undefined;
}

// A lint.metta is a metta-semgrep rule file: its forms are structural patterns over code-as-data
// (lint-rule/pattern/fix/suppress with metavariables), matched by the linter, never evaluated as a MeTTa
// program. So symbol-resolution diagnostics — undefined symbol, unbound space — do not apply to its DSL
// vocabulary or its pattern atoms. The lint parser validates the rule schema separately.
function isLintConfigFile(uri: string): boolean {
  const path = uri.split(/[?#]/)[0] ?? uri;
  return path.slice(path.lastIndexOf("/") + 1) === "lint.metta";
}

// A synthetic definition for a symbol a built-in module declares (json/catalog/fileio). Its type and
// documentation come from the interpreter (get-type/get-doc under the module's import); this record only
// anchors hover, go-to-definition, and completion on it, marked builtin so the hover uses the interpreter doc.
function moduleSymbolDefinition(name: string, moduleName: string): DefinitionRecord {
  return {
    name,
    kind: "function",
    uri: `metta://stdlib/modules/${moduleName}.metta`,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    builtin: true,
    source: moduleName,
  };
}

function completionKindForDefinition(kind: DefinitionKind): CompletionItemKind {
  switch (kind) {
    case "function":
      return CompletionItemKind.Function;
    case "macro":
      return CompletionItemKind.Keyword;
    case "type":
      return CompletionItemKind.TypeParameter;
    case "module":
      return CompletionItemKind.Module;
    case "space":
      return CompletionItemKind.Variable;
    case "binding":
      return CompletionItemKind.Variable;
    case "constant":
      return CompletionItemKind.Constant;
    case "keyword":
      return CompletionItemKind.Keyword;
    case "unknown":
      return CompletionItemKind.Text;
    default:
      return CompletionItemKind.Text;
  }
}

function completionSnippetForDefinition(def: DefinitionRecord): string {
  const args = Array.from(
    { length: def.arity ?? 0 },
    (_, index) => `\${${index + 1}:${ARG_LABELS[index] ?? `$arg${index + 1}`}}`,
  ).join(" ");
  return args ? `(${def.name} ${args})` : `(${def.name})`;
}

function snippetCompletions(): CompletionItem[] {
  return [
    {
      label: "defn",
      kind: CompletionItemKind.Snippet,
      detail: "Function definition",
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: "(= (${1:name} ${2:$x})\n  ${3:body})",
    },
    {
      label: "type-signature",
      kind: CompletionItemKind.Snippet,
      detail: "Type signature",
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: "(: ${1:name} (-> ${2:Input} ${3:Output}))",
    },
    {
      label: "import",
      kind: CompletionItemKind.Snippet,
      detail: "Import file",
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: '(import! &self "${1:path/to/file.metta}")',
    },
    {
      label: "match",
      kind: CompletionItemKind.Snippet,
      detail: "Match expression",
      insertTextFormat: InsertTextFormat.Snippet,
      insertText: "(match ${1:&self} ${2:pattern} ${3:template})",
    },
  ];
}

function duplicateDefinitionKey(def: DefinitionRecord, index: DocumentIndex | undefined): string {
  if (!index || !def.containerRange) return `${def.name}/${def.arity ?? "?"}:${def.kind}`;
  const lhsEnd = def.bodyRange
    ? offsetAt(def.bodyRange.start, index.parsed.lineOffsets, index.text.length)
    : offsetAt(def.selectionRange.end, index.parsed.lineOffsets, index.text.length);
  const lhsStart = offsetAt(def.containerRange.start, index.parsed.lineOffsets, index.text.length);
  const lhs = index.text
    .slice(Math.max(0, lhsStart), Math.max(lhsStart, lhsEnd))
    .replaceAll(/\s+/g, " ")
    .trim();
  // MeTTa allows normal multi-clause rewrite definitions such as
  // (= (fact 0) 1) and (= (fact $n) ...). They share name/arity but are not
  // duplicates because their LHS patterns differ. Only identical declaration
  // heads are considered duplicates.
  return `${def.kind}:${def.name}:${lhs || `${def.arity ?? "?"}`}`;
}

function semanticTypeForSpecialForm(text: string): string | null {
  if (METTA_CONTROL_FLOW_FORMS.has(text)) return "mettaControlFlow";
  if (METTA_BINDING_FORMS.has(text)) return "mettaBinding";
  if (METTA_PATTERN_FORMS.has(text)) return "mettaPattern";
  if (METTA_MODULE_FORMS.has(text)) return "mettaModule";
  if (METTA_TYPE_FORMS.has(text)) return "mettaTypeOperator";
  if (METTA_EVALUATION_FORMS.has(text)) return "mettaEvaluation";
  if (METTA_QUOTE_FORMS.has(text)) return "mettaQuote";
  if (METTA_EFFECT_FORMS.has(text)) return "mettaEffect";
  if (METTA_MATH_FUNCTIONS.has(text)) return "mettaMathFunction";
  if (METTA_COLLECTION_FUNCTIONS.has(text)) return "mettaCollectionFunction";
  if (METTA_PREDICATE_FUNCTIONS.has(text)) return "mettaPredicateFunction";
  if (METTA_ASSERTION_FORMS.has(text)) return "mettaAssertion";
  return SPECIAL_FORMS.has(text) ? "keyword" : null;
}

function semanticTypeForOperator(text: string): string | null {
  if (METTA_ARITHMETIC_OPERATORS.has(text)) return "mettaArithmeticOperator";
  if (METTA_COMPARISON_OPERATORS.has(text)) return "mettaComparisonOperator";
  if (METTA_LOGICAL_OPERATORS.has(text)) return "mettaLogicalOperator";
  return OPERATORS.has(text) ? "operator" : null;
}

function canColourAsUnknownFunction(text: string): boolean {
  return /[A-Za-z_]/.test(text);
}

function commentStartInToken(token: Token): number | null {
  if (token.type === "comment" || token.type === "string") return null;
  const index = token.text.indexOf(";");
  return index < 0 ? null : token.range.start.character + index;
}

function semanticCommentStartsByLine(tokens: readonly Token[]): Map<number, number> {
  const starts = new Map<number, number>();
  for (const token of tokens) {
    if (token.range.start.line !== token.range.end.line) continue;
    const start = commentStartInToken(token);
    if (start === null) continue;
    const line = token.range.start.line;
    starts.set(line, Math.min(starts.get(line) ?? Number.POSITIVE_INFINITY, start));
  }
  return starts;
}

function semanticRangeBeforeComment(
  token: Token,
  commentStarts: ReadonlyMap<number, number>,
): Range | null {
  const commentStart = commentStarts.get(token.range.start.line);
  if (commentStart === undefined) return token.range;
  if (token.range.start.character >= commentStart) return null;
  if (token.range.end.character <= commentStart) return token.range;
  return {
    start: token.range.start,
    end: { line: token.range.start.line, character: commentStart },
  };
}

function semanticTypeForToken(
  token: Token,
  index: DocumentIndex,
  analyzer: Analyzer,
  callHeads: ReadonlySet<string>,
): string | null {
  if (token.type === "comment") return "comment";
  if (token.type === "string") return "string";
  if (token.type === "number") return "number";
  if (token.type === "variable") return "variable";
  // Parentheses stay punctuation on the TextMate layer (green in the metta-lang.dev palette); a semantic
  // token here would let a theme recolour them.
  if (token.type === "open" || token.type === "close") return null;
  const specialFormType = semanticTypeForSpecialForm(token.text);
  if (specialFormType !== null) return specialFormType;
  const operatorType = semanticTypeForOperator(token.text);
  if (operatorType !== null) return operatorType;
  if (STANDARD_TYPES.has(token.text) || /^[A-Z]/.test(token.text)) return "type";
  if (token.text.startsWith("&")) return "property";
  if (BUILTIN_BY_NAME.has(token.text)) {
    const builtin = BUILTIN_BY_NAME.get(token.text);
    return builtin?.kind === "macro" ? "macro" : builtin?.kind === "type" ? "type" : "function";
  }
  // A user symbol is a function when it resolves to one, or sits in call-head position (an as-yet-undefined
  // call). Operands and data atoms fall through to no token, so a function reads distinctly from its
  // arguments instead of everything sharing one colour.
  const kind = analyzer.definitionsFor(token.text, index.uri)[0]?.kind;
  if (kind === "type") return "type";
  if (kind === "macro") return "macro";
  if (kind === "function") return "function";
  if (callHeads.has(rangeKey(token.range)) && canColourAsUnknownFunction(token.text))
    return "function";
  return null;
}

function modifierMask(modifiers: readonly string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    const index = SEMANTIC_TOKEN_MODIFIER_INDEX.get(modifier);
    if (index !== undefined) mask |= 1 << index;
  }
  return mask;
}

function semanticModifiersForToken(
  token: Token,
  index: DocumentIndex,
  analyzer: Analyzer,
  declarationRanges: ReadonlySet<string>,
): string[] {
  const modifiers: string[] = [];
  if (token.type === "symbol" && isBuiltin(token.text))
    modifiers.push("defaultLibrary", "readonly");
  // O(1) lookup into the precomputed declaration ranges; scanning index.definitions per token made semantic
  // tokens O(tokens x definitions).
  if (declarationRanges.has(rangeKey(token.range))) modifiers.push("declaration", "definition");
  if (
    token.type === "symbol" &&
    !isBuiltin(token.text) &&
    !isKeyword(token.text) &&
    !token.text.startsWith("&") &&
    !/^[A-Z]/.test(token.text)
  ) {
    if (analyzer.definitionsFor(token.text, index.uri).length === 0) modifiers.push("undefined");
  }
  return modifiers;
}

function mergeSettings(base: ServerSettings, partial: Partial<ServerSettings>): ServerSettings {
  return {
    diagnostics: { ...base.diagnostics, ...(partial.diagnostics ?? {}) },
    hover: { ...base.hover, ...(partial.hover ?? {}) },
    completion: { ...base.completion, ...(partial.completion ?? {}) },
    workspace: { ...base.workspace, ...(partial.workspace ?? {}) },
    runtime: {
      ...base.runtime,
      ...(partial.runtime ?? {}),
      guard: {
        ...base.runtime.guard,
        ...(partial.runtime?.guard ?? {}),
        experimental: {
          ...base.runtime.guard.experimental,
          ...(partial.runtime?.guard.experimental ?? {}),
        },
      },
    },
    prolog: { ...base.prolog, ...(partial.prolog ?? {}) },
    run: { ...base.run, ...(partial.run ?? {}) },
    docs: { ...base.docs, ...(partial.docs ?? {}) },
    inlayHints: { ...base.inlayHints, ...(partial.inlayHints ?? {}) },
    pseudocode: { ...base.pseudocode, ...(partial.pseudocode ?? {}) },
    format: { ...base.format, ...(partial.format ?? {}) },
  };
}
