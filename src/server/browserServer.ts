import {
  BrowserMessageReader,
  BrowserMessageWriter,
  type CancellationToken,
  createConnection,
  DidChangeConfigurationNotification,
  FileChangeType,
  type InitializeParams,
  LSPErrorCodes,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/browser";
import { TextDocument } from "vscode-languageserver-textdocument";

import { normalizeUri } from "../language-service/index.js";
import { BrowserRuntimeHost } from "../runtime/browserGuardedEvaluation.js";
import { createBrowserSemanticLintJobFactory } from "../runtime/browserSemanticLintJob.js";
import {
  Analyzer,
  DEFAULT_SETTINGS,
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
} from "./analyzer.js";
import { BrowserFileProvider } from "./browserFileProvider.js";
import { capabilitySummary } from "./capabilities.js";
import { configurationToSettings, extractMettaSection } from "./configResolve.js";
import { registerAnalyzerHandlers } from "./registerAnalyzerHandlers.js";
import { SemanticLintScheduler } from "./semanticLintScheduler.js";
import { configurationClientSupport } from "./shared/clientCapabilities.js";
import {
  CapabilityRegistryRequest,
  FsListFilesRequest,
  type FsListFilesResult,
  FsReadFileRequest,
  type FsReadFileResult,
  FsWatchPatternRequest,
  type GuardedEvaluationParams,
  GuardedEvaluationRequest,
  RuntimeCapabilitiesRequest,
  SideEffectPolicyRequest,
} from "./shared/lspRequests.js";

const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope;
const messageReader = new BrowserMessageReader(workerScope);
const messageWriter = new BrowserMessageWriter(workerScope);
const connection = createConnection(ProposedFeatures.all, messageReader, messageWriter);
const documents = new TextDocuments(TextDocument);
const files = new BrowserFileProvider();
const analyzer = new Analyzer(files);
analyzer.setSemanticLintMode("cached");
const runtime = new BrowserRuntimeHost();
let workspaceRoots: string[] = [];
let clientSupportsConfigurationPull = false;
let clientSupportsConfigurationChangeRegistration = false;
let preopenedBrowserWorkspace = false;
let browserWorkspaceReady = false;
let browserWorkspaceFinalization: Promise<BrowserWorkspaceReadyResult> | undefined;
let settings = DEFAULT_SETTINGS;

interface BrowserWorkspaceReadyResult {
  readonly accepted: boolean;
  readonly files: number;
}
const semanticLintScheduler = new SemanticLintScheduler(analyzer, {
  getSettings: () => settings.diagnostics,
  pullDiagnostics: () => false,
  publishDiagnostics: (uri, diagnostics) => {
    void connection.sendDiagnostics({ uri, diagnostics: [...diagnostics] });
  },
  refreshDiagnostics: () => undefined,
  createJob: createBrowserSemanticLintJobFactory(),
  logError: (message) => connection.console.warn(message),
});

function workspaceRootUris(params: InitializeParams): string[] {
  const folders = params.workspaceFolders ?? [];
  if (folders.length > 0) return folders.map((folder) => normalizeUri(folder.uri));
  const legacyRootUri = (params as { readonly rootUri?: string | null }).rootUri;
  return legacyRootUri ? [normalizeUri(legacyRootUri)] : [];
}

function clientPreopensBrowserWorkspace(capabilities: InitializeParams["capabilities"]): boolean {
  const experimental: unknown = capabilities.experimental;
  if (typeof experimental !== "object" || experimental === null) return false;
  const browserIde = (experimental as Record<string, unknown>).mettaBrowserIde;
  return (
    typeof browserIde === "object" &&
    browserIde !== null &&
    (browserIde as Record<string, unknown>).preopenedWorkspace === true
  );
}

function cacheDocument(uri: string, text: string, version: number | null, open: boolean): void {
  const normalized = normalizeUri(uri);
  files.cacheFile(normalized, text);
  analyzer.updateDocument(normalized, text, version, open);
}

function validateAndPublish(uri: string): void {
  void connection.sendDiagnostics({
    uri,
    diagnostics: analyzer.validate(uri, settings.diagnostics),
  });
  semanticLintScheduler.schedule(uri);
}

function revalidateOpenDocuments(): void {
  if (!settings.diagnostics.semanticLint) {
    semanticLintScheduler.dispose();
    analyzer.clearAllSemanticLintDiagnostics();
  }
  for (const document of documents.all()) validateAndPublish(document.uri);
}

async function finalizePreopenedBrowserWorkspace(): Promise<BrowserWorkspaceReadyResult> {
  // BrowserMessageReader may dispatch the request after TextDocuments records didOpen but before this
  // module's didChangeContent listener runs. Yield once so every earlier notification finishes preloading.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (const document of documents.all()) {
    cacheDocument(document.uri, document.getText(), document.version, true);
  }
  analyzer.invalidateConfig();
  analyzer.refreshImportResolutions();
  browserWorkspaceReady = true;
  setTimeout(revalidateOpenDocuments, 0);
  return { accepted: true, files: documents.all().length };
}

function applySettings(config: unknown): void {
  analyzer.updateSettings(configurationToSettings(config));
  settings = analyzer.getSettings();
}

async function refreshSettings(): Promise<void> {
  if (!clientSupportsConfigurationPull) return;
  applySettings(await connection.workspace.getConfiguration("metta"));
}

async function hydrateWorkspace(): Promise<void> {
  if (workspaceRoots.length === 0) return;
  try {
    const result = await connection.sendRequest<FsListFilesResult>(FsListFilesRequest, {
      roots: workspaceRoots,
      extensions: [".metta", ".pl"],
      exclude: settings.workspace.exclude,
      maxFiles: settings.workspace.maxFiles,
    });
    for (const file of result.files) files.cacheFile(normalizeUri(file.uri), file.text);
    await analyzer.scanWorkspace();
    analyzer.refreshImportResolutions();
    if (result.truncated)
      connection.console.warn(
        `workspace file preload reached ${settings.workspace.maxFiles} files`,
      );
    revalidateOpenDocuments();
  } catch (error) {
    connection.console.warn(`workspace file preload unavailable: ${String(error)}`);
  }
}

async function refreshChangedFile(uri: string): Promise<void> {
  const normalized = normalizeUri(uri);
  try {
    const result = await connection.sendRequest<FsReadFileResult>(FsReadFileRequest, {
      uri: normalized,
    });
    if (result.text === null) {
      files.deleteUri(normalized);
      analyzer.forgetDocument(normalized);
      return;
    }
    files.cacheFile(normalized, result.text);
    analyzer.refreshFromDisk(normalized);
  } catch (error) {
    connection.console.warn(`unable to refresh ${normalized}: ${String(error)}`);
  }
}

connection.onInitialize((params) => {
  const configurationSupport = configurationClientSupport(params.capabilities);
  clientSupportsConfigurationPull = configurationSupport.pull;
  clientSupportsConfigurationChangeRegistration = configurationSupport.dynamicRegistration;
  workspaceRoots = workspaceRootUris(params);
  preopenedBrowserWorkspace = clientPreopensBrowserWorkspace(params.capabilities);
  browserWorkspaceReady = false;
  browserWorkspaceFinalization = undefined;
  analyzer.setWorkspaceRoots(workspaceRoots);
  applySettings(extractMettaSection(params.initializationOptions));
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      implementationProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      renameProvider: { prepareProvider: true },
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["(", " ", ":", "$", "&", '"'],
      },
      signatureHelpProvider: { triggerCharacters: ["(", " "] },
      semanticTokensProvider: {
        legend: {
          tokenTypes: [...SEMANTIC_TOKEN_TYPES],
          tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
        },
        full: true,
      },
      foldingRangeProvider: true,
      inlayHintProvider: true,
      documentHighlightProvider: true,
      documentLinkProvider: { resolveProvider: false },
      selectionRangeProvider: true,
      callHierarchyProvider: true,
    },
  };
});

connection.onInitialized(() => {
  void connection
    .sendRequest(FsWatchPatternRequest, { glob: "**/*.{metta,pl}" })
    .catch((error: unknown) => {
      connection.console.warn(`workspace file watcher unavailable: ${String(error)}`);
    });
  if (clientSupportsConfigurationChangeRegistration) {
    connection.client
      .register(DidChangeConfigurationNotification.type, undefined)
      .catch((error: unknown) => {
        connection.console.warn(`configuration notifications unavailable: ${String(error)}`);
      });
  }
  void refreshSettings().then(() => (preopenedBrowserWorkspace ? undefined : hydrateWorkspace()));
});

connection.onDidChangeConfiguration((change) => {
  void (async () => {
    if (clientSupportsConfigurationPull) await refreshSettings();
    else applySettings(extractMettaSection(change.settings));
    await hydrateWorkspace();
    revalidateOpenDocuments();
  })();
});

// TextDocuments emits onDidChangeContent for the initial open and every later edit. Keeping one handler
// avoids indexing and publishing the same opening version twice.
documents.onDidChangeContent((event) => {
  if (preopenedBrowserWorkspace && !browserWorkspaceReady) {
    files.cacheFile(normalizeUri(event.document.uri), event.document.getText());
  } else {
    cacheDocument(event.document.uri, event.document.getText(), event.document.version, true);
    validateAndPublish(event.document.uri);
  }
});
documents.onDidClose((event) => {
  analyzer.closeDocument(event.document.uri);
  semanticLintScheduler.cancel(event.document.uri);
  analyzer.clearSemanticLintDiagnostics(event.document.uri);
  void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});
connection.onDidChangeWatchedFiles((params) => {
  void (async () => {
    let topologyChanged = false;
    for (const change of params.changes) {
      const uri = normalizeUri(change.uri);
      if (change.type !== FileChangeType.Changed) topologyChanged = true;
      if (change.type === FileChangeType.Deleted) {
        files.deleteUri(uri);
        analyzer.forgetDocument(uri);
      } else await refreshChangedFile(uri);
      if (uri.endsWith("lint.metta")) analyzer.invalidateConfig();
    }
    if (topologyChanged) analyzer.refreshImportResolutions();
    revalidateOpenDocuments();
  })();
});
registerAnalyzerHandlers(connection, analyzer);

connection.onRequest(SideEffectPolicyRequest, () => ({
  sideEffectFree: false as const,
  guardedEvaluation: true as const,
  analysisOperationsAreReadOnly: true as const,
  evaluationRequiresExplicitRequest: true as const,
  note: "Browser analysis operations are read-only. Explicit guarded evaluation runs in a browser worker over @metta-ts/core plus @metta-ts/browser/source, with core host effects disabled, import! resolved from the in-memory index, and fuel/time/output bounds applied.",
  defaultGuard: settings.runtime.guard,
}));

connection.onRequest(
  GuardedEvaluationRequest,
  async (params: GuardedEvaluationParams, cancellationToken: CancellationToken) => {
    const cancellation = new AbortController();
    if (cancellationToken.isCancellationRequested) cancellation.abort();
    const subscription = cancellationToken.onCancellationRequested(() => cancellation.abort());
    try {
      const uri = params.uri;
      const source =
        params.source ??
        (uri
          ? analyzer.evaluationSource(uri, params.range, params.includePriorDefinitions !== false)
          : "");
      const result = await runtime.guardedEvaluate(
        {
          source,
          uri,
          policy: { ...settings.runtime.guard, ...(params.policy ?? {}) },
          imports: uri ? analyzer.importSourceMap(uri) : {},
          wrapBareExpression: params.wrapBareExpression,
        },
        cancellation.signal,
      );
      if (cancellationToken.isCancellationRequested) {
        throw new ResponseError(LSPErrorCodes.RequestCancelled, "Evaluation cancelled.");
      }
      return result;
    } finally {
      subscription.dispose();
    }
  },
);

connection.onRequest(CapabilityRegistryRequest, () => capabilitySummary());

connection.onRequest(RuntimeCapabilitiesRequest, () => runtime.capabilities);

connection.onRequest(
  "metta/browserWorkspaceReady",
  async (): Promise<BrowserWorkspaceReadyResult> => {
    if (!preopenedBrowserWorkspace) return { accepted: false, files: documents.all().length };
    if (browserWorkspaceReady) return { accepted: true, files: documents.all().length };
    browserWorkspaceFinalization ??= finalizePreopenedBrowserWorkspace();
    return browserWorkspaceFinalization;
  },
);

connection.onRequest("metta/stdlibDocument", (params: { uri: string }) =>
  analyzer.stdlibDocument(params.uri),
);

documents.listen(connection);
connection.listen();
