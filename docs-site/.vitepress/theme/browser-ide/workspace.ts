// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import {
  LSPPlugin,
  type LSPClient,
  Workspace,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import { EditorState, Text, type ChangeSet, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type BrowserFileStore, browserFileName, browserFileUri } from "./files";

interface WorkspaceFileUpdate {
  readonly file: WorkspaceFile;
  readonly prevDoc: Text;
  readonly changes: ChangeSet;
}

class BrowserWorkspaceFile implements WorkspaceFile {
  public version = 0;
  public view: EditorView | null = null;

  public constructor(
    public uri: string,
    public readonly languageId: string,
    public doc: Text,
  ) {}

  public getView(): EditorView | null {
    return this.view;
  }
}

function textDocument(text: string): Text {
  return Text.of(text.split("\n"));
}

export class BrowserWorkspace extends Workspace {
  public readonly files: BrowserWorkspaceFile[];
  private connectedToServer = false;
  private connectionGeneration = 0;
  private connectionReady: Promise<void> = Promise.resolve();

  public constructor(
    client: LSPClient,
    private readonly store: BrowserFileStore,
    private readonly display: (name: string) => Promise<EditorView | null>,
    private readonly changed: () => void,
    private readonly reportError: (message: string) => void,
  ) {
    super(client);
    this.files = store
      .snapshots()
      .map(
        (file) =>
          new BrowserWorkspaceFile(browserFileUri(file.name), "metta", textDocument(file.text)),
      );
  }

  public override connected(): void {
    this.connectedToServer = false;
    const generation = ++this.connectionGeneration;
    this.connectionReady = this.client.initializing
      .then(async () => {
        if (generation !== this.connectionGeneration) return;
        this.connectedToServer = true;
        for (const file of this.files) this.client.didOpen(file);
        // LSPClient.notification queues one more microtask after initialization.
        await Promise.resolve();
      })
      .catch(() => undefined);
  }

  public override disconnected(): void {
    this.connectionGeneration += 1;
    this.connectedToServer = false;
  }

  public whenConnected(): Promise<void> {
    return this.connectionReady;
  }

  public override openFile(uri: string, languageId: string, view: EditorView): void {
    let file = this.getFile(uri) as BrowserWorkspaceFile | null;
    if (file === null) {
      file = new BrowserWorkspaceFile(uri, languageId, view.state.doc);
      this.files.push(file);
      if (this.connectedToServer) this.client.didOpen(file);
    }
    if (file.view !== null && file.view !== view) {
      throw new Error(`The browser workspace already has an editor for ${uri}.`);
    }
    file.view = view;
    file.doc = view.state.doc;
  }

  public override closeFile(uri: string, view: EditorView): void {
    const file = this.getFile(uri) as BrowserWorkspaceFile | null;
    if (file?.view === view) file.view = null;
  }

  public override syncFiles(): readonly WorkspaceFileUpdate[] {
    const updates: WorkspaceFileUpdate[] = [];
    for (const file of this.files) {
      const view = file.view;
      const plugin = view === null ? null : LSPPlugin.get(view);
      if (view === null || plugin === null || plugin.unsyncedChanges.empty) continue;
      const previous = file.doc;
      const changes = plugin.unsyncedChanges;
      try {
        const name = browserFileName(file.uri);
        if (name !== null) this.store.update(name, view.state.doc.toString());
      } catch (error) {
        this.reportError(error instanceof Error ? error.message : String(error));
        continue;
      }
      file.doc = view.state.doc;
      file.version += 1;
      plugin.clear();
      updates.push({ file, prevDoc: previous, changes });
    }
    if (updates.length > 0) this.changed();
    return updates;
  }

  public override updateFile(uri: string, update: TransactionSpec): void {
    const file = this.getFile(uri) as BrowserWorkspaceFile | null;
    if (file === null) return;
    try {
      if (file.view !== null) {
        file.view.dispatch(update);
        this.client.sync();
        return;
      }
      const transaction = EditorState.create({ doc: file.doc }).update(update);
      const name = browserFileName(uri);
      if (name === null) return;
      this.store.update(name, transaction.state.doc.toString());
      file.doc = transaction.state.doc;
      this.sendFullDocumentChange(file);
      this.changed();
    } catch (error) {
      this.reportError(error instanceof Error ? error.message : String(error));
    }
  }

  public override async displayFile(uri: string): Promise<EditorView | null> {
    const name = browserFileName(uri);
    return name === null || !this.store.has(name) ? null : this.display(name);
  }

  public createFile(inputName: string, text = ""): string {
    const name = this.store.create(inputName, text);
    const file = new BrowserWorkspaceFile(browserFileUri(name), "metta", textDocument(text));
    this.files.push(file);
    if (this.connectedToServer) this.client.didOpen(file);
    this.changed();
    return name;
  }

  public deleteFile(name: string): void {
    const uri = browserFileUri(name);
    const file = this.getFile(uri) as BrowserWorkspaceFile | null;
    if (file?.view !== null) throw new Error("Close the active editor before deleting its file.");
    if (this.connectedToServer && file !== null) this.client.didClose(uri);
    this.store.delete(name);
    if (file !== null) this.files.splice(this.files.indexOf(file), 1);
    this.changed();
  }

  public renameFile(currentName: string, inputName: string): string {
    const currentUri = browserFileUri(currentName);
    const file = this.getFile(currentUri) as BrowserWorkspaceFile | null;
    if (file?.view !== null) throw new Error("Close the active editor before renaming its file.");
    const nextName = this.store.rename(currentName, inputName);
    if (nextName === currentName) return currentName;
    if (this.connectedToServer && file !== null) this.client.didClose(currentUri);
    if (file !== null) {
      file.uri = browserFileUri(nextName);
      file.version = 0;
      if (this.connectedToServer) this.client.didOpen(file);
    }
    this.changed();
    return nextName;
  }

  private sendFullDocumentChange(file: BrowserWorkspaceFile): void {
    file.version += 1;
    this.client.notification("textDocument/didChange", {
      textDocument: { uri: file.uri, version: file.version },
      contentChanges: [{ text: file.doc.toString() }],
    });
  }
}
