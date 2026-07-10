// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type { Transport } from "@codemirror/lsp-client";
import {
  BROWSER_WORKSPACE_ROOT,
  type BrowserFileStore,
  browserFileUri,
} from "./files";

interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

interface WorkerEndpoint {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
}

interface ListFilesParams {
  readonly roots?: readonly string[];
  readonly extensions?: readonly string[];
  readonly maxFiles?: number;
}

interface ReadFileParams {
  readonly uri?: string;
}

interface ConfigurationParams {
  readonly items?: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isServerRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    (typeof value.id === "number" || typeof value.id === "string") &&
    typeof value.method === "string"
  );
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

function withoutTrailingSlash(uri: string): string {
  return uri.endsWith("/") ? uri.slice(0, -1) : uri;
}

function uriIsUnderRoot(uri: string, root: string): boolean {
  const normalizedRoot = withoutTrailingSlash(root);
  return uri === normalizedRoot || uri.startsWith(`${normalizedRoot}/`);
}

// Adapts the browser worker's object messages to CodeMirror's string transport and answers the browser
// file-system requests that vscode-languageclient normally handles in the VS Code Web extension.
export class BrowserWorkerTransport implements Transport {
  private readonly subscribers = new Set<(value: string) => void>();
  private disposed = false;
  private readonly receive = (event: MessageEvent<unknown>): void => this.receiveMessage(event.data);

  public constructor(
    private readonly worker: WorkerEndpoint,
    private readonly files: BrowserFileStore,
  ) {
    worker.addEventListener("message", this.receive);
  }

  public send(message: string): void {
    if (this.disposed) throw new Error("Browser LSP worker is disconnected.");
    this.worker.postMessage(JSON.parse(message) as unknown);
  }

  public subscribe(handler: (value: string) => void): void {
    this.subscribers.add(handler);
  }

  public unsubscribe(handler: (value: string) => void): void {
    this.subscribers.delete(handler);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.receive);
    this.subscribers.clear();
  }

  private receiveMessage(message: unknown): void {
    if (this.disposed) return;
    if (isServerRequest(message) && this.answerServerRequest(message)) return;
    const encoded = JSON.stringify(message);
    for (const subscriber of this.subscribers) subscriber(encoded);
  }

  private answerServerRequest(request: JsonRpcRequest): boolean {
    try {
      switch (request.method) {
        case "metta/fs/listFiles": {
          const params = (request.params ?? {}) as ListFilesParams;
          const roots = Array.isArray(params.roots)
            ? params.roots.filter((root): root is string => typeof root === "string")
            : [];
          const extensions = new Set(
            Array.isArray(params.extensions)
              ? params.extensions.filter(
                  (extension): extension is string => typeof extension === "string",
                )
              : [],
          );
          const requestedMax = params.maxFiles;
          const maxFiles =
            typeof requestedMax === "number" && Number.isFinite(requestedMax)
              ? Math.max(0, Math.floor(requestedMax))
              : this.files.names().length;
          const candidates = this.files.snapshots().filter((file) => {
            const uri = browserFileUri(file.name);
            const rootAllowed =
              roots.length === 0 || roots.some((root) => uriIsUnderRoot(uri, root));
            return rootAllowed && (extensions.size === 0 || extensions.has(fileExtension(file.name)));
          });
          this.respond(request.id, {
            files: candidates.slice(0, maxFiles).map((file) => ({
              uri: browserFileUri(file.name),
              text: file.text,
            })),
            truncated: candidates.length > maxFiles,
          });
          return true;
        }
        case "metta/fs/readFile": {
          const params = (request.params ?? {}) as ReadFileParams;
          const uri = typeof params.uri === "string" ? params.uri : "";
          this.respond(request.id, { uri, text: this.files.getByUri(uri) });
          return true;
        }
        case "metta/fs/watchPattern":
          this.respond(request.id, { watching: true });
          return true;
        case "workspace/configuration": {
          const params = (request.params ?? {}) as ConfigurationParams;
          this.respond(
            request.id,
            Array.from({ length: Array.isArray(params.items) ? params.items.length : 0 }, () => ({})),
          );
          return true;
        }
        case "workspace/workspaceFolders":
          this.respond(request.id, [{ uri: BROWSER_WORKSPACE_ROOT, name: "MeTTa browser workspace" }]);
          return true;
        case "client/registerCapability":
        case "window/workDoneProgress/create":
          this.respond(request.id, null);
          return true;
        default:
          return false;
      }
    } catch (error) {
      this.worker.postMessage({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return true;
    }
  }

  private respond(id: number | string, result: unknown): void {
    this.worker.postMessage({ jsonrpc: "2.0", id, result });
  }
}
