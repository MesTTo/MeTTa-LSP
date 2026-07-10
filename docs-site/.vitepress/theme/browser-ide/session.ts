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

export class BrowserIdeSession {
  public readonly client: LSPClient;
  public readonly workspace: BrowserWorkspace;
  private readonly worker: Worker;
  private readonly transport: BrowserWorkerTransport;
  private stopped = false;

  public constructor(private readonly options: BrowserIdeSessionOptions) {
    this.options.onStatus("starting");
    this.worker = new Worker(options.workerUrl, { type: "module", name: "metta-lsp-browser-ide" });
    this.transport = new BrowserWorkerTransport(this.worker, options.files);
    let workspace: BrowserWorkspace | undefined;
    this.client = new LSPClient({
      rootUri: BROWSER_WORKSPACE_ROOT,
      timeout: 8_000,
      sanitizeHTML: (html) => String(DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })),
      extensions: [...languageServerExtensions(), semanticExtension],
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
      await this.client.initializing;
      if (!this.stopped) this.options.onStatus("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.onStatus("error", message);
      throw error;
    }
  }

  public sync(): void {
    this.client.sync();
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

  public async evaluate(name: string): Promise<BrowserEvaluationResult> {
    this.client.sync();
    return this.client.request(
      "metta/evaluateGuarded",
      { uri: browserFileUri(name), includePriorDefinitions: true, wrapBareExpression: false },
    );
  }

  public async documentSymbols(name: string): Promise<readonly BrowserSymbol[]> {
    this.client.sync();
    return (
      (await this.client.request("textDocument/documentSymbol", {
        textDocument: { uri: browserFileUri(name) },
      })) ?? []
    );
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.client.disconnect();
    this.transport.dispose();
    this.worker.removeEventListener("error", this.workerFailed);
    this.worker.removeEventListener("messageerror", this.workerMessageFailed);
    this.worker.terminate();
    this.options.onStatus("stopped");
  }

  private notifyWatchedFile(uri: string, type: 1 | 2 | 3): void {
    this.client.notification("workspace/didChangeWatchedFiles", { changes: [{ uri, type }] });
  }

  private readonly workerFailed = (event: ErrorEvent): void => {
    if (!this.stopped) this.options.onStatus("error", event.message || "Browser LSP worker failed.");
  };

  private readonly workerMessageFailed = (): void => {
    if (!this.stopped) this.options.onStatus("error", "Browser LSP worker sent an invalid message.");
  };
}

export type { Diagnostic };
