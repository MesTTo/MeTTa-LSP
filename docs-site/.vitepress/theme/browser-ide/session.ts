// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import {
  LSPClient,
  languageServerExtensions,
  type LSPClientExtension,
} from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import DOMPurify from "dompurify";
import type {
  Diagnostic,
  DocumentSymbol,
  LogMessageParams,
  PublishDiagnosticsParams,
  SymbolInformation,
} from "vscode-languageserver-protocol";
import {
  BROWSER_WORKSPACE_ROOT,
  type BrowserFileStore,
  browserFileUri,
} from "./files";
import { semanticTokensClientExtension } from "./semantic-tokens";
import { BrowserWorkerTransport } from "./transport";
import { BrowserWorkspace } from "./workspace";

export type BrowserIdeStatus = "starting" | "ready" | "error" | "stopped";

export interface BrowserQueryResult {
  readonly query: string;
  readonly results: readonly string[];
  readonly resultCount: number;
  readonly truncated: boolean;
}

export interface BrowserEvaluationResult {
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly blockers: readonly string[];
  readonly diagnostics: readonly { readonly message: string }[];
  readonly queries: readonly BrowserQueryResult[];
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly error?: string;
}

export type BrowserSymbol = DocumentSymbol | SymbolInformation;

interface BrowserIdeSessionOptions {
  readonly files: BrowserFileStore;
  readonly workerUrl: string;
  readonly displayFile: (name: string) => Promise<EditorView | null>;
  readonly onDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
  readonly onFilesChanged: () => void;
  readonly onLog: (message: string) => void;
  readonly onStatus: (status: BrowserIdeStatus, message?: string) => void;
}

const semanticExtension: LSPClientExtension = semanticTokensClientExtension;
const browserIdeExtension: LSPClientExtension = {
  clientCapabilities: { experimental: { mettaBrowserIde: { preopenedWorkspace: true } } },
};
const BROWSER_WORKSPACE_READY_METHOD = "metta/browserWorkspaceReady";

export class BrowserIdeSession {
  public readonly client: LSPClient;
  public readonly workspace: BrowserWorkspace;
  private readonly worker: Worker;
  private readonly transport: BrowserWorkerTransport;
  private readonly lifecycle = new AbortController();
  private stopped = false;
  private ready = false;
  private connectionDisposed = false;

  public constructor(private readonly options: BrowserIdeSessionOptions) {
    this.options.onStatus("starting");
    this.worker = new Worker(options.workerUrl, { type: "module", name: "metta-lsp-browser-ide" });
    this.transport = new BrowserWorkerTransport(this.worker, options.files);
    let workspace: BrowserWorkspace | undefined;
    this.client = new LSPClient({
      rootUri: BROWSER_WORKSPACE_ROOT,
      timeout: 8_000,
      sanitizeHTML: (html) => String(DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })),
      extensions: [...languageServerExtensions(), semanticExtension, browserIdeExtension],
      notificationHandlers: {
        "textDocument/publishDiagnostics": (_client, params: PublishDiagnosticsParams) => {
          options.onDiagnostics(params.uri, params.diagnostics);
          return false;
        },
        "window/logMessage": (_client, params: LogMessageParams) => {
          options.onLog(params.message);
          return false;
        },
      },
      workspace: (client) => {
        workspace = new BrowserWorkspace(
          client,
          options.files,
          options.displayFile,
          options.onFilesChanged,
          (message) => options.onStatus("error", message),
        );
        return workspace;
      },
    });
    if (workspace === undefined) throw new Error("Browser workspace initialization failed.");
    this.workspace = workspace;
    this.worker.addEventListener("error", this.workerFailed);
    this.worker.addEventListener("messageerror", this.workerMessageFailed);
  }

  public async start(): Promise<void> {
    this.client.connect(this.transport);
    try {
      await this.waitForLifecycle(() => this.client.initializing);
      await this.waitForLifecycle(() => this.workspace.whenConnected());
      await this.waitForLifecycle(() => this.client.request(BROWSER_WORKSPACE_READY_METHOD, {}));
      if (!this.stopped) {
        this.ready = true;
        this.options.onStatus("ready");
      }
    } catch (error) {
      if (!this.stopped && !this.lifecycle.signal.aborted) this.fail(error);
      throw error;
    }
  }

  public sync(): void {
    if (!this.stopped && !this.lifecycle.signal.aborted) this.client.sync();
  }

  public notifyFileCreated(name: string): void {
    this.notifyWatchedFile(browserFileUri(name), 1);
  }

  public notifyFileChanged(name: string): void {
    this.notifyWatchedFile(browserFileUri(name), 2);
  }

  public notifyFileDeleted(name: string): void {
    this.notifyWatchedFile(browserFileUri(name), 3);
  }

  public async evaluate(name: string, signal?: AbortSignal): Promise<BrowserEvaluationResult> {
    if (!this.lifecycle.signal.aborted) this.client.sync();
    const params = {
      uri: browserFileUri(name),
      includePriorDefinitions: true,
      wrapBareExpression: false,
    };
    return this.request("metta/evaluateGuarded", params, signal);
  }

  public async documentSymbols(
    name: string,
    signal?: AbortSignal,
  ): Promise<readonly BrowserSymbol[]> {
    if (!this.lifecycle.signal.aborted) this.client.sync();
    const params = { textDocument: { uri: browserFileUri(name) } };
    return (
      (await this.request<typeof params, readonly BrowserSymbol[] | null>(
        "textDocument/documentSymbol",
        params,
        signal,
      )) ?? []
    );
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.ready = false;
    this.lifecycle.abort(this.lifecycleError("Browser IDE session stopped."));
    this.disposeConnection();
    this.options.onStatus("stopped");
  }

  private notifyWatchedFile(uri: string, type: 1 | 2 | 3): void {
    if (this.ready) {
      this.client.notification("workspace/didChangeWatchedFiles", { changes: [{ uri, type }] });
    }
  }

  private readonly workerFailed = (event: ErrorEvent): void => {
    if (!this.stopped) this.fail(event.message || "Browser LSP worker failed.");
  };

  private readonly workerMessageFailed = (): void => {
    if (!this.stopped) this.fail("Browser LSP worker sent an invalid message.");
  };

  private fail(reason: unknown): void {
    if (this.lifecycle.signal.aborted) return;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    this.ready = false;
    this.lifecycle.abort(error);
    this.disposeConnection();
    this.options.onStatus("error", error.message);
  }

  private disposeConnection(): void {
    if (this.connectionDisposed) return;
    this.connectionDisposed = true;
    this.client.disconnect();
    this.transport.dispose();
    this.worker.removeEventListener("error", this.workerFailed);
    this.worker.removeEventListener("messageerror", this.workerMessageFailed);
    this.worker.terminate();
  }

  private request<Params, Result>(
    method: string,
    params: Params,
    signal?: AbortSignal,
  ): Promise<Result> {
    return this.waitForLifecycle(
      () => this.client.request<Params, Result>(method, params),
      signal,
      () => this.client.cancelRequest(params),
    );
  }

  private waitForLifecycle<T>(
    startWork: () => Promise<T>,
    operationSignal?: AbortSignal,
    cancelWork?: () => void,
  ): Promise<T> {
    const lifecycleSignal = this.lifecycle.signal;
    if (lifecycleSignal.aborted) return Promise.reject(lifecycleSignal.reason);
    if (operationSignal?.aborted) return Promise.reject(operationSignal.reason);
    let work: Promise<T>;
    try {
      work = startWork();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        lifecycleSignal.removeEventListener("abort", onLifecycleAbort);
        operationSignal?.removeEventListener("abort", onOperationAbort);
        action();
      };
      const cancel = (signal: AbortSignal): void => {
        try {
          cancelWork?.();
        } catch {
          // Local cancellation still settles even if the disconnected transport cannot send its notice.
        } finally {
          finish(() => reject(signal.reason ?? this.lifecycleError("Operation cancelled.")));
        }
      };
      const onLifecycleAbort = (): void => cancel(lifecycleSignal);
      const onOperationAbort = (): void => {
        if (operationSignal !== undefined) cancel(operationSignal);
      };
      lifecycleSignal.addEventListener("abort", onLifecycleAbort, { once: true });
      operationSignal?.addEventListener("abort", onOperationAbort, { once: true });
      void work.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  private lifecycleError(message: string): Error {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }
}

export type { Diagnostic };
