import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type DocumentSymbol,
  type Location,
  type Position,
  type Range,
  type SymbolInformation,
  SymbolKind,
} from "vscode-languageserver-types";

import { normalizeUri, pathToUri, uriToPath } from "../language-service/index.js";
import type { Analyzer } from "./analyzer.js";
import type {
  CompactCallHierarchy,
  CompactCallHierarchyEdgeRow,
  CompactCallHierarchyEdges,
  CompactCallHierarchyRow,
  CompactDocumentSymbolRow,
  CompactDocumentSymbols,
  CompactLocationRow,
  CompactLocations,
  CompactWorkspaceSymbolRow,
  CompactWorkspaceSymbols,
} from "./types.js";

export const LSP_TOOL_OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
  "incomingCalls",
  "outgoingCalls",
] as const;

export type LspToolOperation = (typeof LSP_TOOL_OPERATIONS)[number];

export interface LspToolRequest {
  readonly operation?: LspToolOperation;
  readonly filePath?: string;
  readonly uri?: string;
  readonly text?: string;
  readonly workspaceRoot?: string;
  readonly line?: number;
  readonly character?: number;
  readonly position?: Position;
  readonly query?: string;
  readonly includeDeclaration?: boolean;
  readonly limit?: number;
  readonly resultFormat?: "compact" | "lsp";
}

export interface LspToolExecutionOptions {
  readonly defaultWorkspaceRoot?: string;
  readonly requireExistingFile?: boolean;
  readonly scanWorkspace?: boolean;
}

export interface LspToolResult {
  readonly title: string;
  readonly metadata: {
    readonly operation: LspToolOperation;
    readonly result: unknown;
    readonly filePath?: string;
    readonly uri?: string;
    readonly position?: Position;
    readonly query?: string;
    readonly server: "metta-ts-lsp";
    readonly coordinateSystem: "agent-1-based-input/lsp-0-based-internal";
  };
  readonly output: string;
}

export interface LspToolStatusResult {
  readonly sideEffectFree: false;
  readonly guardedEvaluation: true;
  readonly analysisOperationsAreReadOnly: true;
  readonly evaluationRequiresExplicitToolCall: true;
  readonly agentCompatible: true;
  readonly operations: readonly LspToolOperation[];
  readonly coordinateSystem: "agent-1-based-input/lsp-0-based-internal";
  readonly capabilities: readonly string[];
  readonly stats: unknown;
  readonly policy: unknown;
}

function isOperation(value: unknown): value is LspToolOperation {
  return typeof value === "string" && (LSP_TOOL_OPERATIONS as readonly string[]).includes(value);
}

function normalizeWorkspaceRoot(
  input: string | undefined,
  fallback: string | undefined,
): string | undefined {
  const root = input ?? fallback;
  if (!root) return undefined;
  if (root.startsWith("file://")) return normalizeUri(root);
  return pathToUri(path.resolve(root));
}

function resolveFilePath(
  request: LspToolRequest,
  workspaceRootPath: string | undefined,
): string | undefined {
  if (request.filePath) {
    return path.isAbsolute(request.filePath)
      ? path.resolve(request.filePath)
      : path.resolve(workspaceRootPath ?? process.cwd(), request.filePath);
  }
  if (request.uri?.startsWith("file://") === true) {
    return uriToPath(normalizeUri(request.uri)) ?? undefined;
  }
  return undefined;
}

function resolveUri(request: LspToolRequest, filePath: string | undefined): string | undefined {
  if (request.uri) return normalizeUri(request.uri);
  if (filePath) return pathToUri(filePath);
  if (request.text !== undefined) return "untitled://lsp-tool/input.metta";
  return undefined;
}

function editorPosition(request: LspToolRequest): Position | undefined {
  if (request.position) return request.position;
  if (typeof request.line === "number" && typeof request.character === "number") {
    return {
      line: Math.max(0, Math.trunc(request.line) - 1),
      character: Math.max(0, Math.trunc(request.character) - 1),
    };
  }
  return undefined;
}

function relDisplay(
  filePath: string | undefined,
  workspaceRootPath: string | undefined,
  uri: string | undefined,
): string | undefined {
  if (filePath) {
    return workspaceRootPath
      ? path.relative(workspaceRootPath, filePath) || path.basename(filePath)
      : filePath;
  }
  return uri;
}

function flattenResult(result: unknown): unknown[] {
  if (result == null) return [];
  return Array.isArray(result) ? result : [result];
}

function isCompactResult(result: unknown): result is { readonly count: number } {
  return (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { count?: unknown }).count === "number"
  );
}

function formatOutput(operation: LspToolOperation, result: unknown): string {
  if (isCompactResult(result)) {
    return result.count === 0
      ? `No results found for ${operation}`
      : `${result.count} compact ${operation} results`;
  }
  const items = flattenResult(result);
  return items.length === 0 ? `No results found for ${operation}` : JSON.stringify(result, null, 2);
}

function toolLimit(limit: number | undefined, defaultLimit: number): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : defaultLimit;
}

export function compactWorkspaceSymbols(
  symbols: readonly SymbolInformation[],
  workspaceRootPath: string | undefined,
): CompactWorkspaceSymbols {
  const files = new Map<
    string,
    { readonly path: string; readonly rows: CompactWorkspaceSymbolRow[] }
  >();
  for (const symbol of symbols) {
    const displayPath = compactPathForUri(symbol.location.uri, workspaceRootPath);
    const group = files.get(displayPath) ?? { path: displayPath, rows: [] };
    group.rows.push([
      symbol.name,
      symbol.containerName ?? symbolKindName(symbol.kind),
      symbol.location.range.start.line + 1,
      symbol.location.range.start.character + 1,
    ]);
    files.set(displayPath, group);
  }
  return {
    fields: ["name", "kind", "line", "char"],
    count: symbols.length,
    files: [...files.values()],
  };
}

function compactPathForUri(uri: string, workspaceRootPath: string | undefined): string {
  const normalized = normalizeUri(uri);
  const filePath = uriToPath(normalized);
  if (!filePath) return normalized;
  if (!workspaceRootPath) return filePath;
  const relative = path.relative(workspaceRootPath, filePath);
  if (relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))) {
    return relative || path.basename(filePath);
  }
  return filePath;
}

function symbolKindName(kind: number): string | number {
  switch (kind) {
    case SymbolKind.File:
      return "file";
    case SymbolKind.Module:
      return "module";
    case SymbolKind.Class:
    case SymbolKind.TypeParameter:
      return "type";
    case SymbolKind.Method:
    case SymbolKind.Function:
      return "function";
    case SymbolKind.Property:
      return "property";
    case SymbolKind.Field:
      return "field";
    case SymbolKind.Variable:
      return "variable";
    case SymbolKind.Constant:
      return "constant";
    case SymbolKind.Operator:
      return "operator";
    default:
      return kind;
  }
}

export function compactLocations(
  locations: readonly Location[],
  workspaceRootPath: string | undefined,
): CompactLocations {
  const files = new Map<string, { readonly path: string; readonly rows: CompactLocationRow[] }>();
  for (const location of locations) {
    const displayPath = compactPathForUri(location.uri, workspaceRootPath);
    const group = files.get(displayPath) ?? { path: displayPath, rows: [] };
    group.rows.push([
      location.range.start.line + 1,
      location.range.start.character + 1,
      location.range.end.line + 1,
      location.range.end.character + 1,
    ]);
    files.set(displayPath, group);
  }
  return {
    fields: ["line", "char", "endLine", "endChar"],
    count: locations.length,
    files: [...files.values()],
  };
}

function compactDocumentSymbolRow(symbol: DocumentSymbol): CompactDocumentSymbolRow {
  const row: [string, string | number, number, number] = [
    symbol.name,
    symbolKindName(symbol.kind),
    symbol.selectionRange.start.line + 1,
    symbol.selectionRange.start.character + 1,
  ];
  const children = symbol.children?.map(compactDocumentSymbolRow) ?? [];
  return children.length > 0 ? [...row, children] : row;
}

function countDocumentSymbolRows(rows: readonly CompactDocumentSymbolRow[]): number {
  let count = 0;
  for (const row of rows) {
    count++;
    const children = row[4];
    if (children) count += countDocumentSymbolRows(children);
  }
  return count;
}

export function compactDocumentSymbols(symbols: readonly DocumentSymbol[]): CompactDocumentSymbols {
  const rows = symbols.map(compactDocumentSymbolRow);
  return {
    fields: ["name", "kind", "line", "char", "children"],
    count: countDocumentSymbolRows(rows),
    rows,
  };
}

export function compactCallHierarchyItems(
  items: readonly CallHierarchyItem[],
  workspaceRootPath: string | undefined,
): CompactCallHierarchy {
  const files = new Map<
    string,
    { readonly path: string; readonly rows: CompactCallHierarchyRow[] }
  >();
  for (const item of items) {
    const displayPath = compactPathForUri(item.uri, workspaceRootPath);
    const group = files.get(displayPath) ?? { path: displayPath, rows: [] };
    const row: CompactCallHierarchyRow = item.detail
      ? [
          item.name,
          symbolKindName(item.kind),
          item.selectionRange.start.line + 1,
          item.selectionRange.start.character + 1,
          item.detail,
        ]
      : [
          item.name,
          symbolKindName(item.kind),
          item.selectionRange.start.line + 1,
          item.selectionRange.start.character + 1,
        ];
    group.rows.push(row);
    files.set(displayPath, group);
  }
  return {
    fields: ["name", "kind", "line", "char", "detail"],
    count: items.length,
    files: [...files.values()],
  };
}

export function compactIncomingCalls(
  calls: readonly CallHierarchyIncomingCall[],
  workspaceRootPath: string | undefined,
): CompactCallHierarchyEdges {
  const files = new Map<
    string,
    { readonly path: string; readonly rows: CompactCallHierarchyEdgeRow[] }
  >();
  let count = 0;
  for (const call of calls) {
    const displayPath = compactPathForUri(call.from.uri, workspaceRootPath);
    const group = files.get(displayPath) ?? { path: displayPath, rows: [] };
    for (const range of call.fromRanges) {
      group.rows.push([
        call.from.name,
        symbolKindName(call.from.kind),
        call.from.selectionRange.start.line + 1,
        call.from.selectionRange.start.character + 1,
        range.start.line + 1,
        range.start.character + 1,
      ]);
      count++;
    }
    files.set(displayPath, group);
  }
  return {
    fields: ["name", "kind", "line", "char", "callLine", "callChar"],
    count,
    files: [...files.values()],
  };
}

export function compactOutgoingCalls(
  calls: readonly CallHierarchyOutgoingCall[],
  workspaceRootPath: string | undefined,
): CompactCallHierarchyEdges {
  const files = new Map<
    string,
    { readonly path: string; readonly rows: CompactCallHierarchyEdgeRow[] }
  >();
  let count = 0;
  for (const call of calls) {
    const displayPath = compactPathForUri(call.to.uri, workspaceRootPath);
    const group = files.get(displayPath) ?? { path: displayPath, rows: [] };
    for (const range of call.fromRanges) {
      group.rows.push([
        call.to.name,
        symbolKindName(call.to.kind),
        call.to.selectionRange.start.line + 1,
        call.to.selectionRange.start.character + 1,
        range.start.line + 1,
        range.start.character + 1,
      ]);
      count++;
    }
    files.set(displayPath, group);
  }
  return {
    fields: ["name", "kind", "line", "char", "callLine", "callChar"],
    count,
    files: [...files.values()],
  };
}

function compactOperationResult(
  operation: LspToolOperation,
  rawResult: unknown,
  workspaceRootPath: string | undefined,
): unknown {
  if (operation === "workspaceSymbol") {
    return compactWorkspaceSymbols(rawResult as SymbolInformation[], workspaceRootPath);
  }
  if (operation === "documentSymbol") {
    return compactDocumentSymbols(rawResult as DocumentSymbol[]);
  }
  if (
    operation === "goToDefinition" ||
    operation === "findReferences" ||
    operation === "goToImplementation"
  ) {
    return compactLocations(resultLocations(rawResult), workspaceRootPath);
  }
  if (operation === "prepareCallHierarchy") {
    return compactCallHierarchyItems(rawResult as CallHierarchyItem[], workspaceRootPath);
  }
  if (operation === "incomingCalls") {
    return compactIncomingCalls(rawResult as CallHierarchyIncomingCall[], workspaceRootPath);
  }
  if (operation === "outgoingCalls") {
    return compactOutgoingCalls(rawResult as CallHierarchyOutgoingCall[], workspaceRootPath);
  }
  return rawResult;
}

function workspaceSymbolsForTool(analyzer: Analyzer, request: LspToolRequest): SymbolInformation[] {
  return analyzer.workspaceSymbols(request.query ?? "", {
    limit: toolLimit(request.limit, 50),
  });
}

function firstHierarchyItem(items: readonly CallHierarchyItem[]): CallHierarchyItem | undefined {
  return items[0];
}

// Dispatch a validated operation. Narrowing uri/position here through early throws is what lets callers
// pass them without non-null assertions: workspaceSymbol needs neither, documentSymbol needs only a uri,
// and the position operations need both.
function dispatchOperation(
  analyzer: Analyzer,
  operation: LspToolOperation,
  request: LspToolRequest,
  uri: string | undefined,
  position: Position | undefined,
): unknown {
  if (operation === "workspaceSymbol") {
    return workspaceSymbolsForTool(analyzer, request);
  }
  if (uri === undefined) throw new Error("LSP tool operation requires filePath, uri, or text.");
  if (operation === "documentSymbol") return analyzer.documentSymbols(uri);
  if (position === undefined) {
    throw new Error(`${operation} requires 1-based line and character or a zero-based position.`);
  }
  switch (operation) {
    case "goToDefinition":
      return analyzer.definition(uri, position);
    case "findReferences":
      return analyzer.references(uri, position, request.includeDeclaration !== false);
    case "hover":
      return analyzer.hover(uri, position);
    case "goToImplementation":
      return analyzer.implementation(uri, position);
    case "prepareCallHierarchy":
      return analyzer.prepareCallHierarchy(uri, position);
    case "incomingCalls": {
      const item = firstHierarchyItem(analyzer.prepareCallHierarchy(uri, position));
      return item ? analyzer.incomingCalls(item) : [];
    }
    case "outgoingCalls": {
      const item = firstHierarchyItem(analyzer.prepareCallHierarchy(uri, position));
      return item ? analyzer.outgoingCalls(item) : [];
    }
  }
}

export async function runLspToolOperation(
  analyzer: Analyzer,
  rawRequest: unknown,
  options: LspToolExecutionOptions = {},
): Promise<LspToolResult | LspToolStatusResult> {
  const request = (
    typeof rawRequest === "object" && rawRequest !== null ? rawRequest : {}
  ) as LspToolRequest;
  if (!isOperation(request.operation)) {
    return {
      sideEffectFree: false,
      guardedEvaluation: true,
      analysisOperationsAreReadOnly: true,
      evaluationRequiresExplicitToolCall: true,
      agentCompatible: true,
      operations: LSP_TOOL_OPERATIONS,
      coordinateSystem: "agent-1-based-input/lsp-0-based-internal",
      capabilities: [
        "lsp",
        "goToDefinition",
        "findReferences",
        "hover",
        "documentSymbol",
        "workspaceSymbol",
        "goToImplementation",
        "prepareCallHierarchy",
        "incomingCalls",
        "outgoingCalls",
      ],
      stats: analyzer.stats(),
      policy: analyzer.getSettings().runtime.guard,
    };
  }

  const workspaceRootUri = normalizeWorkspaceRoot(
    request.workspaceRoot,
    options.defaultWorkspaceRoot,
  );
  const workspaceRootPath = workspaceRootUri
    ? (uriToPath(workspaceRootUri) ?? undefined)
    : undefined;
  if (workspaceRootUri) {
    analyzer.setWorkspaceRoots([workspaceRootUri]);
    if (options.scanWorkspace !== false) await analyzer.scanWorkspace();
  }

  const filePath = resolveFilePath(request, workspaceRootPath);
  if (
    options.requireExistingFile === true &&
    request.text === undefined &&
    request.operation !== "workspaceSymbol"
  ) {
    if (!filePath) throw new Error("LSP tool operation requires filePath or file:// uri.");
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  }

  const uri = resolveUri(request, filePath);
  if (uri) {
    if (request.text !== undefined) analyzer.updateDocument(uri, request.text, null, true);
    else analyzer.ensureIndexed(uri);
  }

  const position = editorPosition(request);
  const rawResult = dispatchOperation(analyzer, request.operation, request, uri, position);
  const result =
    request.resultFormat === "lsp"
      ? rawResult
      : compactOperationResult(request.operation, rawResult, workspaceRootPath);

  const display = relDisplay(filePath, workspaceRootPath, uri);
  const detail =
    request.operation === "workspaceSymbol"
      ? ""
      : request.operation === "documentSymbol"
        ? (display ?? "")
        : `${display ?? uri}:${request.line ?? (position ? position.line + 1 : 1)}:${request.character ?? (position ? position.character + 1 : 1)}`;
  const title = detail ? `${request.operation} ${detail}` : request.operation;

  return {
    title,
    metadata: {
      operation: request.operation,
      result,
      ...(filePath ? { filePath } : {}),
      ...(uri ? { uri } : {}),
      ...(position ? { position } : {}),
      ...(request.query !== undefined ? { query: request.query } : {}),
      server: "metta-ts-lsp",
      coordinateSystem: "agent-1-based-input/lsp-0-based-internal",
    },
    output: formatOutput(request.operation, result),
  };
}

export function resultLocations(value: unknown): Location[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (item): item is Location =>
      typeof item === "object" && item !== null && "uri" in item && "range" in item,
  );
}

export function fullDocumentRange(text: string): Range {
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = Math.max(0, lines.length - 1);
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: lines[lastLine]?.length ?? 0 },
  };
}
