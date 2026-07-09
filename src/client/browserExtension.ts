import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
} from "vscode-languageclient/browser";
import { FileChangeType } from "vscode-languageserver-protocol";
import { createWorkspaceExcludeMatcher, workspaceExcludeGlobs } from "../language-service/index.js";
import {
  type FsListFilesParams,
  FsListFilesRequest,
  type FsListFilesResult,
  type FsReadFileParams,
  FsReadFileRequest,
  type FsReadFileResult,
  type FsWatchPatternParams,
  FsWatchPatternRequest,
  type FsWatchPatternResult,
} from "../server/shared/lspRequests.js";

let client: LanguageClient | undefined;
const decoder = new TextDecoder();

function extensionGlob(extensions: readonly string[]): string {
  const clean = extensions.map((ext) => ext.replace(/^\./, "")).filter((ext) => ext.length > 0);
  if (clean.length === 0) return "**/*";
  if (clean.length === 1) return `**/*.${clean[0]}`;
  return `**/*.{${clean.join(",")}}`;
}

function excludeGlob(exclude: readonly string[]): string | undefined {
  const clean = workspaceExcludeGlobs(exclude).filter((pattern) => /^[\w./*?-]+$/.test(pattern));
  return clean.length === 0 ? undefined : `{${clean.join(",")}}`;
}

function uriHasExtension(uri: vscode.Uri, extensions: readonly string[]): boolean {
  if (extensions.length === 0) return true;
  const lowerPath = uri.path.toLowerCase();
  return extensions.some((ext) => lowerPath.endsWith(ext.toLowerCase()));
}

function uriIsUnderRoots(uri: vscode.Uri, roots: readonly string[]): boolean {
  if (roots.length === 0) return true;
  const text = uri.toString();
  return roots.some(
    (root) => text === root || text.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

async function readWorkspaceFile(uriText: string): Promise<FsReadFileResult> {
  try {
    const uri = vscode.Uri.parse(uriText);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return { uri: uriText, text: decoder.decode(bytes) };
  } catch {
    return { uri: uriText, text: null };
  }
}

async function listWorkspaceFiles(params: FsListFilesParams): Promise<FsListFilesResult> {
  const maxFiles = Math.max(0, params.maxFiles);
  if (maxFiles === 0) return { files: [], truncated: true };
  const found = await vscode.workspace.findFiles(
    extensionGlob(params.extensions),
    excludeGlob(params.exclude),
    maxFiles + 1,
  );
  const isExcluded = createWorkspaceExcludeMatcher(params.exclude, { caseSensitive: false });
  const filtered = found
    .filter((uri) => uriHasExtension(uri, params.extensions))
    .filter((uri) => uriIsUnderRoots(uri, params.roots))
    .filter((uri) => !isExcluded(uri.path))
    .slice(0, maxFiles);
  const reads = await mapWithLimit(filtered, 16, (uri) => readWorkspaceFile(uri.toString()));
  return {
    files: reads
      .filter((file): file is { readonly uri: string; readonly text: string } => file.text !== null)
      .map((file) => ({ uri: file.uri, text: file.text })),
    truncated: found.length > maxFiles,
  };
}

function registerFileAccessHandlers(
  context: vscode.ExtensionContext,
  languageClient: LanguageClient,
): void {
  const watchers = new Map<string, vscode.FileSystemWatcher>();
  context.subscriptions.push(
    languageClient.onRequest(FsReadFileRequest, (params: FsReadFileParams) =>
      readWorkspaceFile(params.uri),
    ),
    languageClient.onRequest(FsListFilesRequest, (params: FsListFilesParams) =>
      listWorkspaceFiles(params),
    ),
    languageClient.onRequest(FsWatchPatternRequest, (params: FsWatchPatternParams) => {
      if (!watchers.has(params.glob)) {
        const watcher = vscode.workspace.createFileSystemWatcher(params.glob);
        const send = (uri: vscode.Uri, type: FileChangeType): void => {
          void languageClient.sendNotification("workspace/didChangeWatchedFiles", {
            changes: [{ uri: uri.toString(), type }],
          });
        };
        watcher.onDidCreate(
          (uri) => send(uri, FileChangeType.Created),
          undefined,
          context.subscriptions,
        );
        watcher.onDidChange(
          (uri) => send(uri, FileChangeType.Changed),
          undefined,
          context.subscriptions,
        );
        watcher.onDidDelete(
          (uri) => send(uri, FileChangeType.Deleted),
          undefined,
          context.subscriptions,
        );
        watchers.set(params.glob, watcher);
        context.subscriptions.push(watcher);
      }
      return { watching: true } satisfies FsWatchPatternResult;
    }),
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverMain = vscode.Uri.joinPath(
    context.extensionUri,
    "dist",
    "server",
    "browserServer.js",
  );
  // The DOM Worker and vscode-languageclient's ServerOptions Worker do not unify under the combined
  // DOM+WebWorker libs, so bridge the created worker to the library's own ServerOptions type.
  const worker = new Worker(serverMain.toString(true), { type: "module" });
  const serverOptions = worker as unknown as ServerOptions;
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { language: "metta", scheme: "file" },
      { language: "metta", scheme: "untitled" },
      { language: "metta", scheme: "vscode-vfs" },
    ],
    synchronize: {},
  };
  client = new LanguageClient("metta-ts-lsp-web", "MeTTa LSP Web", serverOptions, clientOptions);
  registerFileAccessHandlers(context, client);
  client.start().catch((error: unknown) => {
    void vscode.window.showErrorMessage(
      `MeTTa LSP Web failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  context.subscriptions.push({
    dispose: () => {
      void client?.stop();
      worker.terminate();
    },
  });
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
