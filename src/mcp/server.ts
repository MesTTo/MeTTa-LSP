#!/usr/bin/env node
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Position } from "vscode-languageserver-types";
import {
  classifyTestQueries,
  normalizeUri,
  pathToUri,
  summarize,
  uriToPath,
} from "../language-service/index.js";
import { evaluateGuarded } from "../runtime/guardedEvaluation.js";
import { NodeFileProvider } from "../runtime/nodeFileProvider.js";
import { traceReduction } from "../runtime/trace.js";
import { Analyzer } from "../server/analyzer.js";
import { HostTypeService } from "../server/bridge/hostTypeService.js";
import {
  CAPABILITIES,
  CAPABILITY_IDS,
  capabilitySummary,
  driftReport,
} from "../server/capabilities.js";
import {
  compactCallHierarchyItems,
  compactDocumentSymbols,
  compactIncomingCalls,
  compactLocations,
  compactOutgoingCalls,
  compactWorkspaceSymbols,
  LSP_TOOL_OPERATIONS,
  runLspToolOperation,
} from "../server/lspTool.js";
import { NodePrologDiagnosticProvider } from "../server/nodePrologDiagnostics.js";
import { collectPrologBridgeDiagnostics } from "../server/prologDiagnosticsScheduler.js";
import type { LspToolInput } from "../server/types.js";
import { pathIsInsideWorkspace } from "../server/workspacePath.js";
import { type AppliedEdits, applyDocumentEdits, applyWorkspaceEditToFiles } from "./applyEdits.js";
import { StdioJsonReader } from "./stdioFraming.js";

interface JsonRpcRequest {
  readonly jsonrpc?: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

const analyzer = new Analyzer(new NodeFileProvider());
const prologDiagnosticProvider = new NodePrologDiagnosticProvider();
analyzer.setPrologDiagnosticProvider(prologDiagnosticProvider);
analyzer.setPrologDiagnosticsMode("cached");
const packageJson = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"),
    "utf8",
  ),
) as { readonly version?: string };
const argv = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (key !== undefined && key.startsWith("--") && value && !value.startsWith("--")) {
    argv.set(key.slice(2), value);
    i++;
  }
}

const workspace = argv.get("workspace") ?? process.cwd();
const configuredWorkspaceRootPath = path.resolve(workspace);
analyzer.setWorkspaceRoots([pathToUri(configuredWorkspaceRootPath)]);
// The cross-language host bridge resolves TypeScript host signatures for grounded atoms; lazy, so it costs
// nothing until a host-type request reaches into the workspace's TypeScript.
analyzer.setHostBridge(new HostTypeService(configuredWorkspaceRootPath));
void analyzer.scanWorkspace();

const commonInputSchema = {
  type: "object",
  properties: {
    operation: {
      type: "string",
      enum: [...LSP_TOOL_OPERATIONS],
      description: "agent-style operation for the lsp/lsp_tool tool.",
    },
    filePath: {
      type: "string",
      description:
        "agent-style absolute or workspace-relative file path. Equivalent to uri for individual tools.",
    },
    uri: {
      type: "string",
      description: "Document URI. File paths are also accepted and converted to file:// URIs.",
    },
    text: {
      type: "string",
      description:
        "Optional document text. When supplied, it is indexed in memory before the tool runs.",
    },
    workspaceRoot: {
      type: "string",
      description: "Optional workspace root path or URI to scan before the tool runs.",
    },
    position: {
      type: "object",
      properties: { line: { type: "number" }, character: { type: "number" } },
      required: ["line", "character"],
    },
    range: {
      type: "object",
      properties: {
        start: {
          type: "object",
          properties: { line: { type: "number" }, character: { type: "number" } },
          required: ["line", "character"],
        },
        end: {
          type: "object",
          properties: { line: { type: "number" }, character: { type: "number" } },
          required: ["line", "character"],
        },
      },
    },
    query: { type: "string" },
    line: { type: "number", description: "agent-style 1-based editor line." },
    character: { type: "number", description: "agent-style 1-based editor character." },
    limit: { type: "number", description: "Optional result limit for workspaceSymbol." },
    resultFormat: {
      type: "string",
      enum: ["compact", "lsp"],
      description:
        "Compact groups symbol and location-style results by file; lsp returns raw protocol objects.",
    },
    newName: { type: "string" },
    includeDeclaration: { type: "boolean" },
    evaluationPolicy: {
      type: "object",
      description:
        "Optional guarded-evaluation resource-bound overrides: fuel, timeoutMs, maxResults, maxResultChars, maxOutputChars, maxStackDepth, maxSourceBytes, tabling.",
    },
    wrapBareExpression: {
      type: "boolean",
      description: "Wrap a bare expression as a bang query before evaluation. Defaults to true.",
    },
  },
};

const codeActionsInputSchema = {
  ...commonInputSchema,
  properties: {
    ...commonInputSchema.properties,
    applyCodeAction: {
      type: "string",
      description:
        "Exact code action title to apply. Omit to list actions without modifying files.",
    },
  },
};

const commonOutputSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    title: { type: "string" },
    diagnostics: { type: "array", items: { type: "object", additionalProperties: true } },
    locations: { type: "array", items: { type: "object", additionalProperties: true } },
    result: {},
    evaluation: { type: "object", additionalProperties: true },
    applied: {
      type: "object",
      properties: {
        files: { type: "array", items: { type: "string" } },
        changed: { type: "boolean" },
      },
    },
    codeActions: { type: "array", items: { type: "object", additionalProperties: true } },
    error: { type: "string" },
  },
};

const tools: ToolDefinition[] = [
  {
    name: "lsp",
    description:
      "agent-facing LSP tool. With operation, dispatches goToDefinition/findReferences/hover/documentSymbol/workspaceSymbol/goToImplementation/prepareCallHierarchy/incomingCalls/outgoingCalls. Without operation, returns capability and guard status.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_tool",
    description: "Alias for the agent-facing operation-dispatched lsp tool.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_diagnostics",
    description: "Parse and validate a MeTTa document without executing it.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_lint",
    description:
      "Run the syntactic linter over a MeTTa document: built-in rules plus project rules from lint.metta, each finding with a rule id, severity, source span, and (where available) an autofix rewrite. No execution.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_run_tests",
    description:
      "Run a MeTTa document's tests: every top-level bang assert form (assertEqual and its family) is evaluated under the guarded runtime and reported as pass/fail/error with the interpreter's failure atom. Returns per-test results and a summary.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_reduce_trace",
    description:
      "Trace the step-by-step reduction of a query (in `query`) against a MeTTa document's definitions: returns each reduction state, e.g. (double 21) -> (* 2 21) -> 42. Bounded to 100 steps. Needs the optional @metta-ts/grapher and @metta-ts/hyperon packages.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_hover",
    description: "Return hover documentation at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_definition",
    description: "Return definition locations at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_host_type",
    description:
      'Resolve the TypeScript host type of the grounded atom at a position: a symbol registered with registerOperation/OperationAtom/edsl op, or a (js-atom "path") global. Returns the host signature (parameters, return, docs), the MeTTa type it maps to, and the cross-language definition location. Null when the position is not a grounded atom or the workspace has no host code.',
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_implementation",
    description: "Return MeTTa implementation locations for a symbol/type at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_references",
    description: "Return references for the symbol at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_rename",
    description:
      "Rename a symbol, write the changes to the files, and return the WorkspaceEdit and summary.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_document_symbols",
    description: "Return document outline symbols.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_workspace_symbols",
    description: "Return workspace symbols matching query.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_format",
    description:
      "Format the document, write the result to the file, and return the edits and summary.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_format_range",
    description: "Format a range, write the result to the file, and return the edits and summary.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_organize_imports",
    description:
      "Organize imports, write the result to the file, and return the edits and summary.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_inlay_hints",
    description: "Return inlay hints for a document range.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_call_hierarchy",
    description: "Return call hierarchy prepare, incoming, and outgoing calls for a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_document_highlight",
    description: "Return same-document read/write highlights for the symbol at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_linked_editing",
    description:
      "Return the ranges of a logic variable's occurrences within its rule, for linked editing (renaming one renames all). Null unless the position is on a variable that occurs more than once.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_document_links",
    description: "Return document links for import/include forms.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_selection_ranges",
    description: "Return CST-backed nested selection ranges.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_type_definition",
    description: "Return type definition locations for the symbol at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_declaration",
    description: "Return declaration locations for the symbol at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_signature_help",
    description: "Return signature help at a call position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_code_actions",
    description:
      "List code actions for a range. Pass applyCodeAction=<title> to apply one action to the files.",
    inputSchema: codeActionsInputSchema,
  },
  {
    name: "lsp_explain_form",
    description: "Explain the current MeTTa form structurally without evaluating it.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_capabilities",
    description: "Return the typed capability registry and surface parity ledger.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_completion",
    description: "Return completion items at a position.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_folding_ranges",
    description: "Return folding ranges.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_semantic_tokens",
    description: "Return semantic tokens for syntax highlighting.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_code_lens",
    description: "Return code lenses for definitions and runnable forms.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_explain",
    description:
      "Explain the MeTTa form at a position, rendering it as mixfix notation (if c then a else b, a * b + c, f(x, y)).",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_capabilities",
    description: "Agent-friendly alias for lsp_capabilities.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_diagnostics",
    description: "Agent-friendly alias for lsp_diagnostics.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_hover",
    description: "Agent-friendly alias for lsp_hover.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_find_definition",
    description: "Agent-friendly alias for lsp_definition.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_find_references",
    description: "Agent-friendly alias for lsp_references.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_document_symbols",
    description: "Agent-friendly alias for lsp_document_symbols.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_format",
    description: "Agent-friendly alias for lsp_format.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_explain_expression",
    description: "Agent-friendly alias for lsp_explain.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_evaluate",
    description:
      "Explicitly evaluate MeTTa under the guarded stateless runtime: worker isolation, fuel/time/output limits, and denied external effects by default.",
    inputSchema: commonInputSchema,
  },
  {
    name: "lsp_guarded_evaluate",
    description: "Alias for lsp_evaluate.",
    inputSchema: commonInputSchema,
  },
  {
    name: "metta_eval",
    description: "Agent-friendly alias for lsp_guarded_evaluate.",
    inputSchema: commonInputSchema,
  },
].map((tool) => ({ ...tool, outputSchema: commonOutputSchema }));

const TOOL_ALIASES: Record<string, string> = {
  metta_diagnostics: "lsp_diagnostics",
  metta_lint: "lsp_lint",
  metta_run_tests: "lsp_run_tests",
  metta_hover: "lsp_hover",
  metta_find_definition: "lsp_definition",
  metta_find_references: "lsp_references",
  metta_document_symbols: "lsp_document_symbols",
  metta_format: "lsp_format",
  metta_eval: "lsp_guarded_evaluate",
  metta_capabilities: "lsp_capabilities",
  metta_explain_expression: "lsp_explain",
};

function toolLimit(limit: number | undefined, defaultLimit: number): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : defaultLimit;
}

async function applyWorkspaceRoot(input: LspToolInput): Promise<string | undefined> {
  if (input.workspaceRoot) {
    const root = normalizeInputUri(input.workspaceRoot, configuredWorkspaceRootPath);
    analyzer.setWorkspaceRoots([root]);
    await analyzer.scanWorkspace();
    return uriToPath(root) ?? undefined;
  }
  const root = analyzer.getWorkspaceRoots()[0];
  return root ? (uriToPath(root) ?? undefined) : undefined;
}

async function prepare(input: LspToolInput): Promise<string | null> {
  const workspaceRootPath = await applyWorkspaceRoot(input);
  const uri = input.uri
    ? normalizeInputUri(input.uri, workspaceRootPath)
    : (input as { filePath?: string }).filePath
      ? normalizeInputUri((input as { filePath: string }).filePath, workspaceRootPath)
      : input.text !== undefined
        ? "untitled://metta-lsp-tool/input.metta"
        : null;
  if (!uri) return null;
  if (input.text !== undefined) analyzer.updateDocument(uri, input.text, null, true);
  else analyzer.ensureIndexed(uri);
  return uri;
}

async function runWorkspaceSymbols(input: LspToolInput): Promise<unknown> {
  const workspaceRootPath = await applyWorkspaceRoot(input);
  if (input.uri || input.filePath || input.text !== undefined) {
    await prepare(input);
  }
  const symbols = analyzer.workspaceSymbols(input.query ?? "", {
    limit: toolLimit(input.limit, 50),
  });
  return {
    workspaceSymbols:
      input.resultFormat === "lsp" ? symbols : compactWorkspaceSymbols(symbols, workspaceRootPath),
  };
}

function activeWorkspaceRootPath(): string | undefined {
  const root = analyzer.getWorkspaceRoots()[0];
  return root ? (uriToPath(root) ?? undefined) : undefined;
}

function activeWorkspaceRootPaths(): string[] {
  const roots = analyzer
    .getWorkspaceRoots()
    .map((root) => uriToPath(root))
    .filter((root): root is string => root !== null);
  return roots.length > 0 ? roots : [configuredWorkspaceRootPath];
}

function refreshAppliedFiles(applied: AppliedEdits): void {
  for (const filePath of applied.files)
    analyzer.updateDocument(pathToUri(filePath), readFileSync(filePath, "utf8"), null, false);
}

function applyDocumentEditsForTool(uri: string, edits: Parameters<typeof applyDocumentEdits>[1]) {
  const applied = applyDocumentEdits(uri, edits, activeWorkspaceRootPaths());
  refreshAppliedFiles(applied);
  return applied;
}

function applyWorkspaceEditForTool(edit: Parameters<typeof applyWorkspaceEditToFiles>[0]) {
  const applied = applyWorkspaceEditToFiles(edit, activeWorkspaceRootPaths());
  refreshAppliedFiles(applied);
  return applied;
}

function assertInsideWorkspaceRoot(filePath: string, rootPath: string | undefined): void {
  const workspaceRootPath = rootPath ?? activeWorkspaceRootPath() ?? configuredWorkspaceRootPath;
  if (!pathIsInsideWorkspace(workspaceRootPath, filePath)) {
    throw new Error(`Path is outside the workspace root: ${filePath}`);
  }
}

function normalizeInputUri(input: string, rootPath: string | undefined): string {
  if (input.startsWith("file://")) {
    const normalized = normalizeUri(input);
    const filePath = uriToPath(normalized);
    if (filePath !== null) assertInsideWorkspaceRoot(path.resolve(filePath), rootPath);
    return normalized;
  }
  if (input.startsWith("untitled://") || input.startsWith("metta://")) return input;
  const basePath = rootPath ?? activeWorkspaceRootPath() ?? configuredWorkspaceRootPath;
  const resolved = path.isAbsolute(input) ? path.resolve(input) : path.resolve(basePath, input);
  assertInsideWorkspaceRoot(resolved, rootPath);
  return pathToUri(resolved);
}

function defaultRange(uri: string) {
  const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
  if (!index) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const lastLine = index.text.split(/\r?\n/).length - 1;
  return {
    start: { line: 0, character: 0 },
    end: { line: lastLine, character: Number.MAX_SAFE_INTEGER },
  };
}

function inputPosition(input: LspToolInput): { line: number; character: number } | undefined {
  if (input.position) return input.position;
  const editorPos = input as { line?: number; character?: number };
  if (typeof editorPos.line === "number" && typeof editorPos.character === "number") {
    return {
      line: Math.max(0, Math.trunc(editorPos.line) - 1),
      character: Math.max(0, Math.trunc(editorPos.character) - 1),
    };
  }
  return undefined;
}

function compactLocationResult(input: LspToolInput, locations: ReturnType<Analyzer["definition"]>) {
  return input.resultFormat === "lsp"
    ? locations
    : compactLocations(locations, activeWorkspaceRootPath());
}

// Run an analyzer call that needs a position, falling back when none was resolved.
function atPosition<T>(
  position: Position | undefined,
  compute: (pos: Position) => T,
  fallback: T,
): T {
  return position === undefined ? fallback : compute(position);
}

function runCallHierarchy(
  uri: string,
  position: Position | undefined,
  input: LspToolInput,
): unknown {
  if (position === undefined) return { callHierarchy: [] };
  const prepared = analyzer.prepareCallHierarchy(uri, position);
  if (input.resultFormat !== "lsp") {
    const workspaceRootPath = activeWorkspaceRootPath();
    return {
      callHierarchy: compactCallHierarchyItems(prepared, workspaceRootPath),
      incoming: compactIncomingCalls(
        prepared.flatMap((item) => analyzer.incomingCalls(item)),
        workspaceRootPath,
      ),
      outgoing: compactOutgoingCalls(
        prepared.flatMap((item) => analyzer.outgoingCalls(item)),
        workspaceRootPath,
      ),
    };
  }
  return {
    callHierarchy: prepared.map((item) => ({
      item,
      incoming: analyzer.incomingCalls(item),
      outgoing: analyzer.outgoingCalls(item),
    })),
  };
}

async function validateWithPrologDiagnostics(uri: string) {
  const initialDiagnostics = analyzer.validate(uri);
  if (!analyzer.getSettings().diagnostics.prolog) {
    analyzer.clearPrologDiagnostics(uri);
    return initialDiagnostics;
  }
  const input = analyzer.prologDiagnosticsInput(uri);
  if (input === null) {
    analyzer.clearPrologDiagnostics(uri);
    return initialDiagnostics;
  }
  if (analyzer.hasFreshPrologDiagnostics(uri)) return initialDiagnostics;
  const diagnostics = await collectPrologBridgeDiagnostics(
    analyzer,
    prologDiagnosticProvider,
    input,
  );
  const current = analyzer.prologDiagnosticsInput(uri);
  if (
    current === null ||
    current.uri !== input.uri ||
    current.version !== input.version ||
    current.referenceKey !== input.referenceKey ||
    current.settingsKey !== input.settingsKey
  )
    return analyzer.validate(uri);
  analyzer.setPrologBridgeDiagnostics(
    input.uri,
    input.version,
    input.referenceKey,
    input.settingsKey,
    diagnostics,
  );
  return analyzer.validate(uri);
}

async function runTests(uri: string, input: LspToolInput): Promise<unknown> {
  const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
  const source = input.text ?? index?.text ?? "";
  const policy = { ...analyzer.getSettings().runtime.guard, ...(input.evaluationPolicy ?? {}) };
  const evaluation = await evaluateGuarded({
    source,
    uri: index?.uri ?? uri,
    policy,
    imports: analyzer.importSourceMap(uri),
    wrapBareExpression: false,
  });
  const results = classifyTestQueries(evaluation.queries);
  return { results, summary: summarize(results), ok: evaluation.ok, blockers: evaluation.blockers };
}

async function runReduceTrace(uri: string, input: LspToolInput): Promise<unknown> {
  const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
  const source = input.text ?? index?.text ?? "";
  const query = input.query ?? "";
  if (query.length === 0) return { error: "reduce_trace requires a query." };
  try {
    return { trace: await traceReduction(source, query, 100) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function runGuardedEvaluate(uri: string, input: LspToolInput): Promise<unknown> {
  const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
  const source =
    input.text !== undefined && input.range === undefined
      ? input.text
      : analyzer.evaluationSource(uri, input.range, true);
  const policy = { ...analyzer.getSettings().runtime.guard, ...(input.evaluationPolicy ?? {}) };
  return {
    evaluation: await evaluateGuarded({
      source,
      uri: index?.uri ?? uri,
      policy,
      // Imports come from the in-memory index and core's import! only resolves this map, never disk, so
      // injecting them is always safe.
      imports: analyzer.importSourceMap(uri),
      wrapBareExpression: input.wrapBareExpression,
    }),
  };
}

async function callTool(name: string, rawInput: unknown): Promise<unknown> {
  name = TOOL_ALIASES[name] ?? name;
  const input = (typeof rawInput === "object" && rawInput !== null ? rawInput : {}) as LspToolInput;
  if (name === "lsp" || name === "lsp_tool") {
    return runLspToolOperation(analyzer, input, {
      defaultWorkspaceRoot: workspace,
      requireExistingFile: false,
      confineToWorkspaceRoot: true,
    });
  }
  if (name === "lsp_capabilities")
    return {
      capabilities: CAPABILITY_IDS,
      summary: capabilitySummary(),
      ledger: CAPABILITIES,
      drift: driftReport(tools.map((tool) => tool.name)),
    };
  if (name === "lsp_workspace_symbols") return runWorkspaceSymbols(input);
  const uri = await prepare(input);
  if (!uri) throw new Error(`Tool ${name} requires uri, filePath, or text.`);
  const position = inputPosition(input);
  switch (name) {
    case "lsp_diagnostics":
      return { diagnostics: await validateWithPrologDiagnostics(uri) };
    case "lsp_lint":
      return { findings: analyzer.lintFindings(uri) };
    case "lsp_hover":
      return { hover: atPosition(position, (p) => analyzer.hover(uri, p), null) };
    case "lsp_definition": {
      const locations = atPosition(position, (p) => analyzer.definition(uri, p), []);
      return { definition: compactLocationResult(input, locations) };
    }
    case "lsp_host_type":
      return { hostType: atPosition(position, (p) => analyzer.hostTypeAt(uri, p) ?? null, null) };
    case "lsp_implementation": {
      const locations = atPosition(position, (p) => analyzer.implementation(uri, p), []);
      return { implementation: compactLocationResult(input, locations) };
    }
    case "lsp_references": {
      const locations = atPosition(
        position,
        (p) => analyzer.references(uri, p, input.includeDeclaration !== false),
        [],
      );
      return { references: compactLocationResult(input, locations) };
    }
    case "lsp_rename": {
      const edit = position && input.newName ? analyzer.rename(uri, position, input.newName) : null;
      if (!edit) return { rename: null };
      return { rename: edit, applied: applyWorkspaceEditForTool(edit) };
    }
    case "lsp_document_symbols": {
      const symbols = analyzer.documentSymbols(uri);
      return {
        documentSymbols: input.resultFormat === "lsp" ? symbols : compactDocumentSymbols(symbols),
      };
    }
    case "lsp_format": {
      const edits = analyzer.formatDocument(uri);
      return { formatting: edits, applied: applyDocumentEditsForTool(uri, edits) };
    }
    case "lsp_format_range": {
      const edits = analyzer.formatRange(uri, input.range ?? defaultRange(uri));
      return { formatting: edits, applied: applyDocumentEditsForTool(uri, edits) };
    }
    case "lsp_organize_imports": {
      const edits = analyzer.organizeImports(uri);
      return {
        organizeImports: edits,
        applied: applyDocumentEditsForTool(uri, edits),
      };
    }
    case "lsp_inlay_hints":
      return { inlayHints: analyzer.inlayHints(uri, input.range ?? defaultRange(uri)) };
    case "lsp_call_hierarchy":
      return runCallHierarchy(uri, position, input);
    case "lsp_document_highlight":
      return { highlights: atPosition(position, (p) => analyzer.documentHighlights(uri, p), []) };
    case "lsp_linked_editing":
      return {
        linkedEditing: atPosition(position, (p) => analyzer.linkedEditingRanges(uri, p), null),
      };
    case "lsp_selection_ranges":
      return {
        selectionRanges: analyzer.selectionRanges(
          uri,
          position ? [position] : [input.range?.start ?? { line: 0, character: 0 }],
        ),
      };
    case "lsp_declaration": {
      const locations = atPosition(position, (p) => analyzer.declaration(uri, p), []);
      return { declaration: compactLocationResult(input, locations) };
    }
    case "lsp_type_definition": {
      const locations = atPosition(position, (p) => analyzer.typeDefinition(uri, p), []);
      return { typeDefinition: compactLocationResult(input, locations) };
    }
    case "lsp_signature_help":
      return { signatureHelp: atPosition(position, (p) => analyzer.signatureHelp(uri, p), null) };
    case "lsp_code_actions": {
      const codeActions = analyzer.codeActions(uri, input.range ?? defaultRange(uri));
      if (input.applyCodeAction === undefined) return { codeActions };
      const action = codeActions.find((candidate) => candidate.title === input.applyCodeAction);
      if (action === undefined)
        return {
          codeActions,
          error: `No code action titled '${input.applyCodeAction}' was found.`,
        };
      if (action.edit === undefined)
        return {
          codeActions,
          error: `Code action '${input.applyCodeAction}' has no edit to apply.`,
        };
      return {
        codeActions,
        applied: applyWorkspaceEditForTool(action.edit),
      };
    }
    case "lsp_explain_form":
      return { explanation: atPosition(position, (p) => analyzer.explainForm(uri, p), null) };
    case "lsp_completion":
      return { completions: atPosition(position, (p) => analyzer.completions(uri, p), []) };
    case "lsp_folding_ranges":
      return { foldingRanges: analyzer.foldingRanges(uri) };
    case "lsp_semantic_tokens":
      return { semanticTokens: analyzer.semanticTokens(uri) };
    case "lsp_code_lens":
      return { codeLens: analyzer.codeLenses(uri) };
    case "lsp_explain":
      return { explanation: atPosition(position, (p) => analyzer.explainAt(uri, p), null) };
    case "lsp_evaluate":
    case "lsp_guarded_evaluate":
      return runGuardedEvaluate(uri, input);
    case "lsp_run_tests":
      return runTests(uri, input);
    case "lsp_reduce_trace":
      return runReduceTrace(uri, input);
    default:
      throw new Error(`Unknown tool '${name}'.`);
  }
}

function respond(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

let requestQueue: Promise<void> = Promise.resolve();

function parseAndHandle(body: string): void {
  try {
    const request = JSON.parse(body) as JsonRpcRequest;
    requestQueue = requestQueue.then(
      () => handle(request),
      () => handle(request),
    );
  } catch (error) {
    respond({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

async function handle(request: JsonRpcRequest): Promise<void> {
  const id = request.id ?? null;
  try {
    if (request.method === "initialize") {
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "metta-ts-lsp", version: packageJson.version ?? "0.0.0" },
          capabilities: { tools: {} },
        },
      });
      return;
    }
    if (request.method === "tools/list") {
      respond({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }
    if (request.method === "tools/call") {
      const params = request.params as { name?: string; arguments?: unknown } | undefined;
      if (!params?.name) throw new Error("tools/call requires params.name");
      const result = await callTool(params.name, params.arguments);
      respond({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false,
        },
      });
      return;
    }
    if (request.method === "ping") {
      respond({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (request.id !== undefined)
      respond({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
  } catch (error) {
    respond({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

const reader = new StdioJsonReader({
  onMessage: parseAndHandle,
  onProtocolError: (message) => {
    respond({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message },
    });
  },
});

process.stdin.on("data", (chunk: Buffer) => reader.push(chunk));

process.stdin.resume();
