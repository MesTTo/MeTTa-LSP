import {
  createConnection,
  DidChangeConfigurationNotification,
  DocumentDiagnosticReportKind,
  FileChangeType,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  type Range,
  TextDocuments,
  type WorkspaceDocumentDiagnosticReport,
  type WorkspaceFolder,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { normalizeUri, uriToPath } from "../language-service/index.js";
import { evaluateGuarded, evaluateUnguarded } from "../runtime/guardedEvaluation.js";
import { NodeFileProvider } from "../runtime/nodeFileProvider.js";
import { createNodeSemanticLintJob } from "../runtime/nodeSemanticLintJob.js";
import { NODE_RUNTIME_CAPABILITIES } from "../runtime/runtimeHost.js";
import { traceReduction } from "../runtime/trace.js";
import { framesToHtml, reductionFrames } from "../runtime/visualise.js";
import { Analyzer, DEFAULT_SETTINGS } from "./analyzer.js";
import { HostTypeService } from "./bridge/hostTypeService.js";
import { CAPABILITIES, CAPABILITY_IDS, capabilitySummary } from "./capabilities.js";
import { configurationToSettings, extractMettaSection } from "./configResolve.js";
import { createLogger, parseLogLevel } from "./logger.js";
import { runLspToolOperation } from "./lspTool.js";
import { NodePrologDiagnosticProvider } from "./nodePrologDiagnostics.js";
import { PrologDiagnosticsScheduler } from "./prologDiagnosticsScheduler.js";
import { registerAnalyzerHandlers } from "./registerAnalyzerHandlers.js";
import { SemanticLintScheduler } from "./semanticLintScheduler.js";
import { serverCapabilities } from "./serverCapabilities.js";
import {
  CapabilityRegistryRequest,
  type GuardedEvaluationParams,
  GuardedEvaluationRequest,
  IndexStatsRequest,
  LspToolRequest,
  RuntimeCapabilitiesRequest,
  SideEffectPolicyRequest,
  type TraceParams,
  TraceRequest,
  type TraceResultPayload,
} from "./shared/lspRequests.js";
import type { ServerSettings } from "./types.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const analyzer = new Analyzer(new NodeFileProvider());
const prologDiagnosticProvider = new NodePrologDiagnosticProvider();
analyzer.setPrologDiagnosticProvider(prologDiagnosticProvider);
analyzer.setPrologDiagnosticsMode("cached");
analyzer.setSemanticLintMode("cached");

// Structured, leveled logging over LSP window/logMessage — visible in VS Code's "MeTTa Language Server" output
// channel and delivered to every other LSP client. The level follows metta.logLevel (default info).
const logger = createLogger(connection.console, "info");
const documentLog = logger.child("document");
const validateLog = logger.child("validate");

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// Whether the client pulls diagnostics (textDocument/diagnostic). If it does, the server must NOT also push
// via publishDiagnostics — a client that supports both renders each diagnostic twice.
let clientSupportsPullDiagnostics = false;
let workspaceFolders: WorkspaceFolder[] = [];
let settings: ServerSettings = DEFAULT_SETTINGS;
let clientProcessId: number | null = null;
let parentWatchdog: NodeJS.Timeout | null = null;

const WORKSPACE_DIAGNOSTIC_BATCH_SIZE = 16;

const semanticLintScheduler = new SemanticLintScheduler(analyzer, {
  getSettings: () => settings.diagnostics,
  pullDiagnostics: () => clientSupportsPullDiagnostics,
  publishDiagnostics: (uri, diagnostics) => {
    void connection.sendDiagnostics({ uri, diagnostics: [...diagnostics] });
  },
  createJob: createNodeSemanticLintJob,
  refreshDiagnostics: () => {
    void connection.languages.diagnostics.refresh().catch((error: unknown) => {
      validateLog.warn(`unable to refresh semantic lint diagnostics: ${String(error)}`);
    });
  },
  logError: (message) => validateLog.warn(message),
});

const prologDiagnosticsScheduler = new PrologDiagnosticsScheduler(
  analyzer,
  prologDiagnosticProvider,
  {
    getSettings: () => settings.diagnostics,
    pullDiagnostics: () => clientSupportsPullDiagnostics,
    publishDiagnostics: (uri, diagnostics) => {
      void connection.sendDiagnostics({ uri, diagnostics: [...diagnostics] });
    },
    refreshDiagnostics: () => {
      void connection.languages.diagnostics.refresh().catch((error: unknown) => {
        validateLog.warn(`unable to refresh Prolog diagnostics: ${String(error)}`);
      });
    },
    logError: (message) => validateLog.warn(message),
  },
);

// (Re)build the cross-language host bridge from the primary workspace root so grounded-atom hover and
// go-to-definition can reach into the TypeScript host. Construction is lazy inside HostTypeService, so this
// is cheap even when a workspace has no host code. A single-root bridge covers the common case; a
// multi-project workspace resolves against its first folder.
function updateHostBridge(): void {
  const root = workspaceFolders[0]?.uri;
  const rootPath = root === undefined ? null : uriToPath(root);
  analyzer.setHostBridge(rootPath === null ? undefined : new HostTypeService(rootPath));
}

// Apply a resolved metta config object to the analyzer and sync the module copy used by validation.
function applySettings(config: unknown): void {
  analyzer.updateSettings(configurationToSettings(config));
  settings = analyzer.getSettings();
  logger.setLevel(parseLogLevel(asRecord(config).logLevel));
}

// Pull the configuration when the client supports workspace/configuration (VS Code, Emacs lsp-mode and
// eglot). Clients without pull deliver settings through initializationOptions at startup and
// didChangeConfiguration pushes instead, so there is nothing to pull for them.
async function refreshSettings(): Promise<void> {
  if (!hasConfigurationCapability) return;
  applySettings(await connection.workspace.getConfiguration("metta"));
}

async function revalidateAll(): Promise<void> {
  if (!settings.diagnostics.semanticLint) {
    semanticLintScheduler.dispose();
    analyzer.clearAllSemanticLintDiagnostics();
  }
  if (!settings.diagnostics.prolog) {
    prologDiagnosticsScheduler.dispose();
    analyzer.clearAllPrologDiagnostics();
  }
  // Settings changed. A pull client re-requests diagnostics for every open document when asked to refresh
  // (the pull provider reads the current settings); a push client gets a fresh publish per document.
  if (clientSupportsPullDiagnostics) {
    await connection.languages.diagnostics.refresh();
    semanticLintScheduler.scheduleAll(documents.all().map((document) => document.uri));
    prologDiagnosticsScheduler.scheduleAll(documents.all().map((document) => document.uri));
    return;
  }
  for (const document of documents.all()) validateAndPublish(document);
}

// Sync the document into the analyzer. A pull client (VS Code, Emacs) then re-requests diagnostics through
// the diagnostic provider; a push-only client has no pull channel, so publish to it directly. Doing both
// would double every diagnostic on a client that supports both.
function validateAndPublish(document: TextDocument): void {
  const start = performance.now();
  analyzer.updateDocument(document.uri, document.getText(), document.version, true);
  if (clientSupportsPullDiagnostics) {
    semanticLintScheduler.schedule(document.uri);
    prologDiagnosticsScheduler.schedule(document.uri);
    return;
  }
  const diagnostics = analyzer.validate(document.uri, settings.diagnostics);
  void connection.sendDiagnostics({ uri: document.uri, diagnostics });
  semanticLintScheduler.schedule(document.uri);
  prologDiagnosticsScheduler.schedule(document.uri);
  validateLog.debug(document.uri, {
    diagnostics: diagnostics.length,
    ms: Math.round(performance.now() - start),
  });
}

function workspaceDiagnosticReport(uri: string): WorkspaceDocumentDiagnosticReport {
  return {
    kind: DocumentDiagnosticReportKind.Full,
    uri,
    version: null,
    items: analyzer.validate(uri, settings.diagnostics),
  };
}

function workspaceRootUris(folders: readonly WorkspaceFolder[] | null | undefined): string[] {
  return (folders ?? []).map((folder) => normalizeUri(folder.uri));
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseClientProcessId(params: InitializeParams): number | null {
  if (
    typeof params.processId === "number" &&
    params.processId > 0 &&
    params.processId !== process.pid
  )
    return params.processId;
  const arg = process.argv.find((value) => value.startsWith("--clientProcessId="));
  if (arg) {
    const parsed = Number(arg.slice("--clientProcessId=".length));
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== process.pid) return parsed;
  }
  const index = process.argv.indexOf("--clientProcessId");
  if (index >= 0) {
    const parsed = Number(process.argv[index + 1]);
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== process.pid) return parsed;
  }
  return null;
}

function startParentWatchdog(): void {
  if (clientProcessId === null || parentWatchdog) return;
  parentWatchdog = setInterval(() => {
    if (clientProcessId === null) return;
    try {
      process.kill(clientProcessId, 0);
    } catch {
      logger.error(`exiting: client process ${clientProcessId} is no longer alive`);
      process.exit(0);
    }
  }, 5000);
  parentWatchdog.unref();
}

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = capabilities.workspace?.configuration === true;
  hasWorkspaceFolderCapability = capabilities.workspace?.workspaceFolders === true;
  clientSupportsPullDiagnostics = capabilities.textDocument?.diagnostic !== undefined;
  workspaceFolders = params.workspaceFolders ?? [];
  clientProcessId = parseClientProcessId(params);
  analyzer.setWorkspaceRoots(workspaceRootUris(workspaceFolders));
  updateHostBridge();

  // initializationOptions is the first settings source and, for a client without pull that never pushes
  // (Helix), the only one. A pull client (VS Code, Emacs) refines this in onInitialized.
  applySettings(extractMettaSection(params.initializationOptions));

  logger.info("initializing", {
    client: params.clientInfo?.name ?? "unknown",
    pullDiagnostics: clientSupportsPullDiagnostics,
    roots: workspaceFolders.length,
  });
  return { capabilities: serverCapabilities() };
});

connection.onInitialized(() => {
  startParentWatchdog();
  void refreshSettings().then(async () => {
    const done = logger.time("workspace scan");
    await analyzer.scanWorkspace();
    await revalidateAll();
    done();
    logger.info(`ready — ${documents.all().length} open document(s)`);
  });

  if (hasConfigurationCapability) {
    connection.client
      .register(DidChangeConfigurationNotification.type, undefined)
      .catch((error: unknown) => {
        logger.warn(`unable to register configuration notifications: ${String(error)}`);
      });
  }

  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((event) => {
      workspaceFolders = [
        ...workspaceFolders.filter(
          (folder) => !event.removed.some((removed) => removed.uri === folder.uri),
        ),
        ...event.added,
      ];
      analyzer.setWorkspaceRoots(workspaceRootUris(workspaceFolders));
      updateHostBridge();
      void analyzer.scanWorkspace().then(() => revalidateAll());
    });
  }
});

// A pull client (VS Code, Emacs) re-pulls; a push client (Neovim, Sublime, minimal clients) carries the
// settings in change.settings, section-keyed or direct. Then revalidate every open document.
connection.onDidChangeConfiguration((change) => {
  void (async () => {
    if (hasConfigurationCapability) await refreshSettings();
    else applySettings(extractMettaSection(change.settings));
    await revalidateAll();
  })();
});

documents.onDidOpen((event) => {
  documentLog.debug(`opened ${event.document.uri}`);
  validateAndPublish(event.document);
});
documents.onDidChangeContent((change) => {
  validateAndPublish(change.document);
});
documents.onDidClose((event) => {
  documentLog.debug(`closed ${event.document.uri}`);
  analyzer.closeDocument(event.document.uri);
  semanticLintScheduler.cancel(event.document.uri);
  prologDiagnosticsScheduler.cancel(event.document.uri);
  analyzer.clearSemanticLintDiagnostics(event.document.uri);
  analyzer.clearPrologDiagnostics(event.document.uri);
  // A pull client clears a closed document's diagnostics itself; only a push client needs the empty publish.
  if (!clientSupportsPullDiagnostics)
    void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Files changed on disk outside the editor (a git checkout, another editor, a generated file). The client
// forwards its `**/*.{metta,pl}` watcher here; re-index each so an unopened dependency stays current,
// invalidate the cached lint.metta config when it changes, then re-validate the open documents whose closure
// may now differ.
connection.onDidChangeWatchedFiles((params) => {
  let configChanged = false;
  let prologChanged = false;
  let topologyChanged = false;
  for (const change of params.changes) {
    if (change.uri.endsWith("lint.metta")) configChanged = true;
    if (change.uri.toLowerCase().endsWith(".pl")) prologChanged = true;
    if (change.type !== FileChangeType.Changed) topologyChanged = true;
    if (change.type === FileChangeType.Deleted) analyzer.forgetDocument(change.uri);
    else analyzer.refreshFromDisk(change.uri);
  }
  if (configChanged) analyzer.invalidateConfig();
  if (prologChanged) analyzer.clearAllPrologDiagnostics();
  if (topologyChanged) analyzer.refreshImportResolutions();
  void revalidateAll();
});

registerAnalyzerHandlers(connection, analyzer, {
  hoverSettings: () => settings.hover,
  completionSettings: () => settings.completion,
});
connection.onTypeDefinition((params) =>
  analyzer.typeDefinition(params.textDocument.uri, params.position),
);
connection.onDeclaration((params) =>
  analyzer.declaration(params.textDocument.uri, params.position),
);
connection.onDocumentOnTypeFormatting((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  return analyzer.formatRange(params.textDocument.uri, {
    start: { line: Math.max(0, params.position.line - 1), character: 0 },
    end: { line: params.position.line, character: Number.MAX_SAFE_INTEGER },
  });
});
// When a .metta file is renamed, return the edits that update import!/include references to it, so they land
// atomically with the rename.
connection.workspace.onWillRenameFiles((params) => analyzer.renameFileImportEdits(params.files));
connection.onCodeAction((params) => analyzer.codeActions(params.textDocument.uri, params.range));
connection.onCodeLens((params) => analyzer.codeLenses(params.textDocument.uri));
// Render a guarded evaluation result into a short notification for the executeCommand path (a codelens
// "Evaluate" click on a client that has no handler of its own).
function summarizeEvaluation(result: Awaited<ReturnType<typeof evaluateGuarded>>): string {
  if (!result.ok)
    return `MeTTa evaluation blocked: ${result.error ?? (result.blockers.length > 0 ? result.blockers.join("; ") : "evaluation failed")}`;
  if (result.queries.length === 0) return "MeTTa: nothing to evaluate.";
  return result.queries
    .map((query) => `${query.query} => [${query.results.join(", ")}]`)
    .join("\n");
}

async function traceRequest(params: TraceParams): Promise<TraceResultPayload> {
  const uri = normalizeUri(params.uri);
  const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
  const query =
    params.query !== undefined && params.query.trim().length > 0
      ? params.query
      : (analyzer.executableQuery(uri, params.range) ?? "");
  if (query.length === 0) {
    return {
      ok: false,
      query,
      steps: [],
      final: [],
      truncated: false,
      error: "No executable query in this file: add a !(...) form or a trailing call.",
    };
  }
  try {
    const trace = await traceReduction(
      index?.text ?? "",
      query,
      Math.max(1, params.maxSteps ?? 100),
      analyzer.importSourceMap(uri),
    );
    return { ok: true, ...trace };
  } catch (error) {
    return {
      ok: false,
      query,
      steps: [],
      final: [],
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// The advertised workspace commands. VS Code routes these through its own client handlers, but any other LSP
// client invokes a codelens command as `workspace/executeCommand`, so the server executes them too instead
// of the previous no-op.
connection.onExecuteCommand(async (params) => {
  const first: unknown = (params.arguments ?? [])[0];
  const arg = (first ?? {}) as { uri?: string; range?: Range; includePriorDefinitions?: boolean };
  if (params.command === "metta.lsp.evaluateGuarded" && arg.uri !== undefined) {
    const uri = normalizeUri(arg.uri);
    const result = await evaluateGuarded({
      source: analyzer.evaluationSource(uri, arg.range, arg.includePriorDefinitions !== false),
      uri,
      policy: settings.runtime.guard,
      imports: analyzer.importSourceMap(uri),
      importPaths: analyzer.importPathMap(uri),
      wrapBareExpression: false,
    });
    connection.window.showInformationMessage(summarizeEvaluation(result));
    return null;
  }
  if (params.command === "metta.lsp.organizeImports" && arg.uri !== undefined) {
    const uri = normalizeUri(arg.uri);
    const edits = analyzer.organizeImports(uri);
    if (edits.length > 0) await connection.workspace.applyEdit({ changes: { [uri]: edits } });
    return null;
  }
  if (params.command === "metta.lsp.trace" && arg.uri !== undefined) {
    const result = await traceRequest({ uri: arg.uri, range: arg.range });
    connection.window.showInformationMessage(
      result.ok
        ? `MeTTa trace: ${result.steps.length} step${result.steps.length === 1 ? "" : "s"}.`
        : `MeTTa trace failed: ${result.error ?? "unknown error"}`,
    );
    return result;
  }
  return null;
});
connection.languages.semanticTokens.onRange((params) =>
  analyzer.semanticTokens(params.textDocument.uri, params.range),
);
connection.languages.onLinkedEditingRange((params) =>
  analyzer.linkedEditingRanges(params.textDocument.uri, params.position),
);

connection.languages.diagnostics.on((params) => {
  const items = analyzer.validate(params.textDocument.uri, settings.diagnostics);
  semanticLintScheduler.schedule(params.textDocument.uri);
  prologDiagnosticsScheduler.schedule(params.textDocument.uri);
  return {
    kind: DocumentDiagnosticReportKind.Full,
    items,
  };
});
connection.languages.diagnostics.onWorkspace(
  (_params, token, _workDoneProgress, resultProgress) => {
    const uris = analyzer.indexedUris();
    semanticLintScheduler.scheduleAll(uris);
    prologDiagnosticsScheduler.scheduleAll(uris);
    if (resultProgress !== undefined) {
      for (let index = 0; index < uris.length; index += WORKSPACE_DIAGNOSTIC_BATCH_SIZE) {
        if (token.isCancellationRequested) break;
        resultProgress.report({
          items: uris
            .slice(index, index + WORKSPACE_DIAGNOSTIC_BATCH_SIZE)
            .map((uri) => workspaceDiagnosticReport(uri)),
        });
      }
      return { items: [] };
    }
    return {
      items: uris.map((uri) => workspaceDiagnosticReport(uri)),
    };
  },
);

connection.onRequest(IndexStatsRequest, () => analyzer.stats());
connection.onRequest(SideEffectPolicyRequest, () => ({
  sideEffectFree: false as const,
  guardedEvaluation: true as const,
  analysisOperationsAreReadOnly: true as const,
  evaluationRequiresExplicitRequest: true as const,
  note: "Analysis operations parse, index, validate, and return locations or text edits. Explicit guarded evaluation runs in a stateless worker over @metta-ts/core plus the source-only @metta-ts/node runner, with core host effects disabled, import! resolved from the in-memory index rather than disk, and fuel/time/output bounds applied.",
  defaultGuard: settings.runtime.guard,
}));

connection.onRequest(GuardedEvaluationRequest, async (params: GuardedEvaluationParams) => {
  const uri = params.uri ? normalizeUri(params.uri) : undefined;
  const source =
    params.source ??
    (uri
      ? analyzer.evaluationSource(uri, params.range, params.includePriorDefinitions !== false)
      : "");
  return evaluateGuarded({
    source,
    uri,
    policy: { ...settings.runtime.guard, ...(params.policy ?? {}) },
    // Injecting the workspace's resolved imports is safe: they come from the in-memory index, and core's
    // import! only resolves this map, never disk. So imports are always provided when a document is known.
    imports: uri ? analyzer.importSourceMap(uri) : {},
    importPaths: uri ? analyzer.importPathMap(uri) : {},
    wrapBareExpression: params.wrapBareExpression,
  });
});

// The unguarded "Run" path used by the play button and the run code lens: no LSP caps beyond the configurable
// metta.run fuel/timeout, so MeTTa's pragma! governs. Runs the whole file, or one form when a range is given —
// evaluationSource bang-wraps a bare form and prepends the prior definitions and directives it needs.
connection.onRequest("metta/run", async (params: { uri: string; range?: Range }) => {
  const uri = normalizeUri(params.uri);
  return evaluateUnguarded(
    {
      source: analyzer.evaluationSource(uri, params.range, true),
      uri,
      policy: settings.runtime.guard,
      imports: analyzer.importSourceMap(uri),
      importPaths: analyzer.importPathMap(uri),
      wrapBareExpression: false,
    },
    { fuel: settings.run.fuel, timeoutMs: settings.run.timeoutMs },
  );
});

connection.onRequest(TraceRequest, traceRequest);

// The text of a generated stdlib reference (metta://stdlib/…), so the client content provider can render the
// read-only document Go to Definition on a builtin opens.
connection.onRequest("metta/stdlibDocument", (params: { uri: string }) =>
  analyzer.stdlibDocument(params.uri),
);

connection.onRequest(LspToolRequest, (params: unknown) =>
  runLspToolOperation(analyzer, params, {
    defaultWorkspaceRoot: workspaceFolders[0]?.uri,
    requireExistingFile: false,
  }),
);
connection.onRequest(CapabilityRegistryRequest, () => capabilitySummary());
connection.onRequest(RuntimeCapabilitiesRequest, () => NODE_RUNTIME_CAPABILITIES);

connection.onRequest("metta/lsp", () => ({
  capabilities: CAPABILITY_IDS,
  capabilitySummary: capabilitySummary(),
  ledger: CAPABILITIES,
  sideEffectFree: false,
  guardedEvaluation: true,
  analysisOperationsAreReadOnly: true,
}));

connection.onRequest("metta/organizeImports", (params: { uri: string }) => ({
  changes: { [params.uri]: analyzer.organizeImports(params.uri) },
}));

// The file's resolved imports (module name -> source), for the debug launch: the debug adapter must not reach
// the server to resolve them, so the client fetches them here and passes them in the launch config.
connection.onRequest("metta/imports", (params: { uri: string }) =>
  analyzer.importSourceMap(params.uri),
);

// A self-contained HTML page that plays through a query's reduction, for the VS Code visualise webview. The
// frames come from the runtime, so the client (which cannot reach the runtime layer) requests the page here.
connection.onRequest(
  "metta/visualise",
  async (params: { uri: string; query?: string; block?: boolean }) => {
    const uri = normalizeUri(params.uri);
    const index = analyzer.getDocument(uri) ?? analyzer.ensureIndexed(uri);
    // No query given: reduce the file's own executable query (its last ! form or trailing call), so a
    // client can visualise a document without prompting for anything.
    const query =
      params.query !== undefined && params.query.trim().length > 0
        ? params.query
        : (analyzer.executableQuery(uri) ?? "");
    if (query.length === 0)
      return { error: "No executable query in this file: add a !(...) form or a trailing call." };
    try {
      const result = await reductionFrames(index?.text ?? "", query, {
        block: params.block,
        imports: analyzer.importSourceMap(uri),
      });
      return { html: framesToHtml(result, `${query} reduction`) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
);

connection.onRequest(
  "metta/explainForm",
  (params: { uri: string; position: { line: number; character: number } }) =>
    analyzer.explainForm(normalizeUri(params.uri), params.position),
);

documents.listen(connection);
connection.listen();
