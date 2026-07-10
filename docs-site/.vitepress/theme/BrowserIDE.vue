<!--
SPDX-FileCopyrightText: 2026 MesTTo
SPDX-License-Identifier: Apache-2.0
-->
<script setup lang="ts">
import { indentWithTab } from "@codemirror/commands";
import {
  findReferences,
  formatDocument,
  jumpToDefinition,
  renameSymbol,
} from "@codemirror/lsp-client";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type ViewUpdate } from "@codemirror/view";
import {
  Braces,
  CircleAlert,
  CircleCheck,
  FilePenLine,
  FilePlus2,
  ListTree,
  LoaderCircle,
  Pencil,
  Play,
  RotateCcw,
  SearchCode,
  TriangleAlert,
  Trash2,
  X,
} from "@lucide/vue";
import { basicSetup } from "codemirror";
import { withBase } from "vitepress";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from "vue";
import type { DocumentSymbol, Range, SymbolInformation } from "vscode-languageserver-protocol";
import {
  BrowserFileStore,
  DEFAULT_BROWSER_FILES,
  browserFileName,
  browserFileUri,
  loadBrowserWorkspace,
  saveBrowserWorkspace,
} from "./browser-ide/files";
import { mettaLanguageExtensions } from "./browser-ide/metta-language";
import {
  BrowserIdeSession,
  type BrowserEvaluationResult,
  type BrowserIdeStatus,
  type BrowserSymbol,
  type Diagnostic,
} from "./browser-ide/session";
import {
  SemanticTokenController,
  semanticTokenDecorations,
} from "./browser-ide/semantic-tokens";

type PanelName = "problems" | "output" | "symbols";
type DialogMode = "create" | "rename" | "delete" | "reset";

interface ProblemRow {
  readonly name: string;
  readonly diagnostic: Diagnostic;
}

interface SymbolRow {
  readonly name: string;
  readonly detail: string;
  readonly depth: number;
  readonly range: Range;
}

interface IdeFeatureSupport {
  readonly definition: boolean;
  readonly references: boolean;
  readonly rename: boolean;
  readonly formatting: boolean;
}

const NO_FEATURE_SUPPORT: IdeFeatureSupport = {
  definition: false,
  references: false,
  rename: false,
  formatting: false,
};

const editorHost = ref<HTMLElement | null>(null);
const fileDialog = ref<HTMLDialogElement | null>(null);
const fileNameInput = ref<HTMLInputElement | null>(null);
const editor = shallowRef<EditorView>();
const status = ref<BrowserIdeStatus>("starting");
const statusDetail = ref("");
const activeName = ref("main.metta");
const fileNames = ref<string[]>([]);
const activePanel = ref<PanelName>("problems");
const diagnosticsByUri = ref(new Map<string, readonly Diagnostic[]>());
const symbols = ref<SymbolRow[]>([]);
const evaluation = ref<BrowserEvaluationResult>();
const running = ref(false);
const line = ref(1);
const column = ref(1);
const dialogMode = ref<DialogMode>("create");
const dialogTarget = ref("");
const dialogName = ref("");
const dialogError = ref("");
const featureSupport = ref<IdeFeatureSupport>(NO_FEATURE_SUPPORT);
const statusNotice = ref("");

let files = new BrowserFileStore();
let session: BrowserIdeSession | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let symbolTimer: ReturnType<typeof setTimeout> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const semanticTokens = new SemanticTokenController();

const problems = computed<readonly ProblemRow[]>(() => {
  const rows: ProblemRow[] = [];
  for (const [uri, diagnostics] of diagnosticsByUri.value) {
    const name = browserFileName(uri);
    if (name === null) continue;
    for (const diagnostic of diagnostics) rows.push({ name, diagnostic });
  }
  return rows.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.diagnostic.range.start.line - right.diagnostic.range.start.line ||
      left.diagnostic.range.start.character - right.diagnostic.range.start.character,
  );
});

const errorCount = computed(
  () => problems.value.filter((problem) => problem.diagnostic.severity === 1).length,
);
const warningCount = computed(
  () => problems.value.filter((problem) => problem.diagnostic.severity === 2).length,
);
const dialogTitle = computed(() => {
  if (dialogMode.value === "create") return "New file";
  if (dialogMode.value === "rename") return "Rename file";
  if (dialogMode.value === "delete") return "Delete file";
  return "Reset workspace";
});
const dialogAction = computed(() => {
  if (dialogMode.value === "create") return "Create";
  if (dialogMode.value === "rename") return "Rename";
  if (dialogMode.value === "delete") return "Delete";
  return "Reset";
});

function refreshFileNames(): void {
  fileNames.value = [...files.names()];
}

function persistNow(): void {
  if (typeof window !== "undefined") saveBrowserWorkspace(window.localStorage, files, activeName.value);
}

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistNow();
  }, 180);
}

function diagnosticLabel(diagnostic: Diagnostic): string {
  const code = diagnostic.code === undefined ? "" : `${String(diagnostic.code)}: `;
  return `${code}${diagnostic.message}`;
}

function diagnosticKind(diagnostic: Diagnostic): string {
  if (diagnostic.severity === 1) return "Error";
  if (diagnostic.severity === 2) return "Warning";
  if (diagnostic.severity === 3) return "Information";
  return "Hint";
}

function setStatus(next: BrowserIdeStatus, detail = ""): void {
  status.value = next;
  statusDetail.value = detail;
}

function showStatusNotice(message: string): void {
  statusNotice.value = message;
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    noticeTimer = undefined;
    statusNotice.value = "";
  }, 4_000);
}

function updateCursor(view: EditorView): void {
  const position = view.state.selection.main.head;
  const documentLine = view.state.doc.lineAt(position);
  line.value = documentLine.number;
  column.value = position - documentLine.from + 1;
}

function editorTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      color: "var(--vp-c-text-1)",
      backgroundColor: "var(--vp-code-block-bg)",
      fontSize: "13px",
    },
    ".cm-scroller": {
      fontFamily: "var(--vp-font-family-mono)",
      lineHeight: "1.62",
      overflow: "auto",
    },
    ".cm-content": { minHeight: "100%", padding: "12px 0" },
    ".cm-line": { padding: "0 16px 0 8px" },
    ".cm-gutters": {
      color: "var(--vp-c-text-3)",
      backgroundColor: "var(--vp-code-block-bg)",
      borderRight: "1px solid var(--vp-c-divider)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
      backgroundColor: "color-mix(in srgb, var(--vp-c-brand-1) 7%, transparent)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "color-mix(in srgb, var(--vp-c-brand-1) 24%, transparent)",
    },
    ".cm-cursor": { borderLeftColor: "var(--vp-c-text-1)" },
    "&.cm-focused": { outline: "none" },
    ".cm-tooltip, .cm-panels": {
      color: "var(--vp-c-text-1)",
      backgroundColor: "var(--vp-c-bg-elv)",
      borderColor: "var(--vp-c-divider)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      color: "var(--vp-c-white)",
      backgroundColor: "var(--vp-c-brand-1)",
    },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #e05252" },
    ".cm-lintRange-warning": {
      backgroundImage: "none",
      textDecoration: "underline wavy var(--metta-code-accent)",
    },
  });
}

function scheduleSync(update?: ViewUpdate): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    if (session === undefined || editor.value === undefined) return;
    session.sync();
    semanticTokens.schedule(session.client, editor.value, browserFileUri(activeName.value));
    scheduleSymbols();
    schedulePersist();
  }, update?.docChanged ? 90 : 0);
}

function scheduleSymbols(): void {
  if (symbolTimer !== undefined) clearTimeout(symbolTimer);
  symbolTimer = setTimeout(() => {
    symbolTimer = undefined;
    void refreshSymbols();
  }, 220);
}

function createEditor(): EditorView | null {
  if (editorHost.value === null || session === undefined) return null;
  editorHost.value.replaceChildren();
  const uri = browserFileUri(activeName.value);
  const view = new EditorView({
    parent: editorHost.value,
    doc: files.get(activeName.value),
    extensions: [
      basicSetup,
      mettaLanguageExtensions,
      semanticTokenDecorations,
      editorTheme(),
      keymap.of([
        indentWithTab,
        {
          key: "Mod-Enter",
          run: () => {
            void runProgram();
            return true;
          },
          preventDefault: true,
        },
      ]),
      EditorView.editorAttributes.of({
        "aria-label": `${activeName.value} MeTTa editor`,
        spellcheck: "false",
      }),
      EditorState.transactionFilter.of((transaction) => {
        if (!transaction.docChanged) return transaction;
        try {
          files.validateUpdateLength(activeName.value, transaction.newDoc.length);
          return transaction;
        } catch (error) {
          showStatusNotice(error instanceof Error ? error.message : String(error));
          return [];
        }
      }),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) updateCursor(update.view);
        if (update.docChanged) scheduleSync(update);
      }),
      session.client.plugin(uri, "metta"),
    ],
  });
  editor.value = view;
  updateCursor(view);
  semanticTokens.schedule(session.client, view, uri, 0);
  return view;
}

function destroyEditor(): void {
  if (editor.value !== undefined) {
    session?.sync();
    semanticTokens.clear(editor.value);
    editor.value.destroy();
    editor.value = undefined;
  }
  editorHost.value?.replaceChildren();
}

async function displayFile(name: string): Promise<EditorView | null> {
  await selectFile(name);
  return editor.value ?? null;
}

async function selectFile(name: string): Promise<void> {
  if (!files.has(name)) return;
  if (name === activeName.value && editor.value !== undefined) {
    editor.value.focus();
    return;
  }
  destroyEditor();
  activeName.value = name;
  evaluation.value = undefined;
  await nextTick();
  createEditor()?.focus();
  persistNow();
  await refreshSymbols();
}

async function startSession(): Promise<void> {
  setStatus("starting");
  statusDetail.value = "";
  try {
    const nextSession = new BrowserIdeSession({
      files,
      workerUrl: withBase("/browser-ide/server/browserServer.js"),
      displayFile,
      onDiagnostics: (uri, diagnostics) => {
        const next = new Map(diagnosticsByUri.value);
        next.set(uri, diagnostics);
        diagnosticsByUri.value = next;
      },
      onFilesChanged: () => {
        refreshFileNames();
        schedulePersist();
      },
      onLog: (message) => {
        if (message.trim() !== "") statusDetail.value = message;
      },
      onStatus: setStatus,
    });
    session = nextSession;
    await nextSession.start();
    if (session !== nextSession) return;
    const capabilities = nextSession.client.serverCapabilities;
    featureSupport.value = {
      definition: Boolean(capabilities?.definitionProvider),
      references: Boolean(capabilities?.referencesProvider),
      rename: Boolean(capabilities?.renameProvider),
      formatting: Boolean(capabilities?.documentFormattingProvider),
    };
    await nextTick();
    createEditor();
    await refreshSymbols();
  } catch (error) {
    setStatus("error", error instanceof Error ? error.message : String(error));
  }
}

function stopSession(): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer);
  if (symbolTimer !== undefined) clearTimeout(symbolTimer);
  syncTimer = undefined;
  symbolTimer = undefined;
  destroyEditor();
  semanticTokens.dispose();
  session?.stop();
  session = undefined;
  featureSupport.value = NO_FEATURE_SUPPORT;
}

async function restartSession(): Promise<void> {
  persistNow();
  stopSession();
  diagnosticsByUri.value = new Map();
  symbols.value = [];
  await nextTick();
  await startSession();
}

async function runProgram(): Promise<void> {
  if (session === undefined || status.value !== "ready" || running.value) return;
  running.value = true;
  activePanel.value = "output";
  evaluation.value = undefined;
  try {
    evaluation.value = await session.evaluate(activeName.value);
  } catch (error) {
    evaluation.value = {
      ok: false,
      elapsedMs: 0,
      blockers: [],
      diagnostics: [],
      queries: [],
      stdout: "",
      stderr: "",
      truncated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    running.value = false;
  }
}

function flattenSymbols(input: readonly BrowserSymbol[], depth = 0): SymbolRow[] {
  const rows: SymbolRow[] = [];
  for (const symbol of input) {
    if ("location" in symbol) {
      const information = symbol as SymbolInformation;
      rows.push({
        name: information.name,
        detail: symbolKind(information.kind),
        depth,
        range: information.location.range,
      });
      continue;
    }
    const documentSymbol = symbol as DocumentSymbol;
    rows.push({
      name: documentSymbol.name,
      detail: documentSymbol.detail ?? symbolKind(documentSymbol.kind),
      depth,
      range: documentSymbol.selectionRange,
    });
    if (documentSymbol.children !== undefined) {
      rows.push(...flattenSymbols(documentSymbol.children, depth + 1));
    }
  }
  return rows;
}

function symbolKind(kind: number): string {
  const names = [
    "",
    "File",
    "Module",
    "Namespace",
    "Package",
    "Class",
    "Method",
    "Property",
    "Field",
    "Constructor",
    "Enum",
    "Interface",
    "Function",
    "Variable",
    "Constant",
    "String",
    "Number",
    "Boolean",
    "Array",
    "Object",
    "Key",
    "Null",
    "Enum member",
    "Struct",
    "Event",
    "Operator",
    "Type parameter",
  ];
  return names[kind] ?? "Symbol";
}

async function refreshSymbols(): Promise<void> {
  if (session === undefined || status.value !== "ready") return;
  try {
    symbols.value = flattenSymbols(await session.documentSymbols(activeName.value));
  } catch {
    symbols.value = [];
  }
}

function invokeEditorCommand(command: (view: EditorView) => boolean): void {
  const view = editor.value;
  if (view !== undefined) {
    command(view);
    view.focus();
  }
}

function goToDefinition(): void {
  invokeEditorCommand(jumpToDefinition);
}

function showReferences(): void {
  invokeEditorCommand(findReferences);
}

function renameSelectedSymbol(): void {
  invokeEditorCommand(renameSymbol);
}

function formatActiveDocument(): void {
  invokeEditorCommand(formatDocument);
}

function offsetForRange(view: EditorView, range: Range): number {
  const targetLine = Math.min(view.state.doc.lines, Math.max(1, range.start.line + 1));
  const documentLine = view.state.doc.line(targetLine);
  return Math.min(documentLine.to, documentLine.from + Math.max(0, range.start.character));
}

async function reveal(name: string, range: Range): Promise<void> {
  await selectFile(name);
  const view = editor.value;
  if (view === undefined) return;
  const position = offsetForRange(view, range);
  view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
  view.focus();
}

function openDialog(mode: DialogMode, target = ""): void {
  dialogMode.value = mode;
  dialogTarget.value = target;
  dialogName.value = mode === "rename" ? target : "";
  dialogError.value = "";
  const dialog = fileDialog.value;
  if (dialog === null) return;
  if (dialog.open) dialog.close();
  dialog.showModal();
  void nextTick(() => fileNameInput.value?.select());
}

function closeDialog(): void {
  fileDialog.value?.close();
  dialogError.value = "";
}

async function submitDialog(): Promise<void> {
  const currentSession = session;
  if (currentSession === undefined) return;
  try {
    if (dialogMode.value === "create") {
      const name = currentSession.workspace.createFile(dialogName.value);
      currentSession.notifyFileCreated(name);
      refreshFileNames();
      closeDialog();
      await selectFile(name);
      return;
    }
    if (dialogMode.value === "rename") {
      const oldName = dialogTarget.value;
      const wasActive = oldName === activeName.value;
      if (wasActive) destroyEditor();
      const nextName = currentSession.workspace.renameFile(oldName, dialogName.value);
      currentSession.notifyFileDeleted(oldName);
      currentSession.notifyFileCreated(nextName);
      if (wasActive) activeName.value = nextName;
      refreshFileNames();
      closeDialog();
      if (wasActive) {
        await nextTick();
        createEditor()?.focus();
      }
      persistNow();
      return;
    }
    if (dialogMode.value === "delete") {
      const name = dialogTarget.value;
      const wasActive = name === activeName.value;
      if (wasActive) destroyEditor();
      currentSession.workspace.deleteFile(name);
      currentSession.notifyFileDeleted(name);
      refreshFileNames();
      diagnosticsByUri.value.delete(browserFileUri(name));
      diagnosticsByUri.value = new Map(diagnosticsByUri.value);
      if (wasActive) activeName.value = fileNames.value[0] ?? "main.metta";
      closeDialog();
      if (wasActive) {
        await nextTick();
        createEditor()?.focus();
        await refreshSymbols();
      }
      persistNow();
      return;
    }
    closeDialog();
    stopSession();
    files = new BrowserFileStore(DEFAULT_BROWSER_FILES);
    activeName.value = "main.metta";
    evaluation.value = undefined;
    diagnosticsByUri.value = new Map();
    symbols.value = [];
    refreshFileNames();
    persistNow();
    await nextTick();
    await startSession();
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : String(error);
    if (editor.value === undefined && files.has(activeName.value)) {
      await nextTick();
      createEditor();
    }
  }
}

onMounted(async () => {
  const saved = loadBrowserWorkspace(window.localStorage);
  if (saved !== null) {
    files = new BrowserFileStore(saved.files);
    activeName.value = saved.activeName;
  }
  refreshFileNames();
  await startSession();
});

onBeforeUnmount(() => {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  persistNow();
  stopSession();
});
</script>

<template>
  <div class="browser-ide-shell" :class="`is-${status}`">
    <header class="ide-toolbar">
      <div class="ide-product">
        <img :src="withBase('/favicon.png')" alt="" width="24" height="24" />
        <strong>Browser IDE</strong>
        <span class="ide-connection" :class="`is-${status}`" role="status" aria-live="polite">
          <LoaderCircle v-if="status === 'starting'" :size="14" class="spin" aria-hidden="true" />
          <CircleCheck v-else-if="status === 'ready'" :size="14" aria-hidden="true" />
          <CircleAlert v-else-if="status === 'error'" :size="14" aria-hidden="true" />
          <span>{{ status === "ready" ? "LSP ready" : status === "starting" ? "Starting" : "LSP error" }}</span>
        </span>
      </div>
      <div class="ide-actions" aria-label="Editor commands">
        <button
          class="icon-button"
          type="button"
          title="Go to definition"
          aria-label="Go to definition"
          :disabled="status !== 'ready' || !featureSupport.definition"
          @click="goToDefinition"
        >
          <SearchCode :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          title="Find references"
          aria-label="Find references"
          :disabled="status !== 'ready' || !featureSupport.references"
          @click="showReferences"
        >
          <ListTree :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          title="Rename symbol"
          aria-label="Rename symbol"
          :disabled="status !== 'ready' || !featureSupport.rename"
          @click="renameSelectedSymbol"
        >
          <Pencil :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          title="Format document"
          aria-label="Format document"
          :disabled="status !== 'ready' || !featureSupport.formatting"
          @click="formatActiveDocument"
        >
          <Braces :size="17" aria-hidden="true" />
        </button>
        <button
          class="icon-button"
          type="button"
          title="Restart language server"
          aria-label="Restart language server"
          @click="restartSession"
        >
          <RotateCcw :size="17" aria-hidden="true" />
        </button>
        <button
          class="run-button"
          type="button"
          :disabled="status !== 'ready' || running"
          @click="runProgram"
        >
          <LoaderCircle v-if="running" :size="16" class="spin" aria-hidden="true" />
          <Play v-else :size="16" fill="currentColor" aria-hidden="true" />
          <span>{{ running ? "Running" : "Run" }}</span>
        </button>
      </div>
    </header>

    <aside class="file-pane" aria-label="Workspace files">
      <div class="pane-heading">
        <span>Files</span>
        <button
          class="icon-button compact"
          type="button"
          title="New file"
          aria-label="New file"
          @click="openDialog('create')"
        >
          <FilePlus2 :size="16" aria-hidden="true" />
        </button>
      </div>
      <div class="file-list" role="listbox" aria-label="MeTTa files">
        <div
          v-for="name in fileNames"
          :key="name"
          class="file-row"
          :class="{ active: name === activeName }"
          role="presentation"
        >
          <button
            class="file-select"
            type="button"
            role="option"
            :aria-selected="name === activeName"
            :title="name"
            @click="selectFile(name)"
          >
            <span class="file-dot" aria-hidden="true"></span>
            <span>{{ name }}</span>
          </button>
          <div class="file-actions">
            <button
              class="icon-button compact"
              type="button"
              title="Rename file"
              :aria-label="`Rename ${name}`"
              @click="openDialog('rename', name)"
            >
              <FilePenLine :size="14" aria-hidden="true" />
            </button>
            <button
              class="icon-button compact danger"
              type="button"
              title="Delete file"
              :aria-label="`Delete ${name}`"
              :disabled="fileNames.length === 1"
              @click="openDialog('delete', name)"
            >
              <Trash2 :size="14" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      <button class="reset-workspace" type="button" @click="openDialog('reset')">
        <RotateCcw :size="14" aria-hidden="true" />
        <span>Reset workspace</span>
      </button>
    </aside>

    <main class="editor-pane">
      <div class="editor-heading">
        <span class="editor-file">{{ activeName }}</span>
        <span class="editor-language">MeTTa</span>
      </div>
      <div ref="editorHost" class="editor-host"></div>
      <div v-if="status === 'starting'" class="ide-state" aria-live="polite">
        <LoaderCircle :size="24" class="spin" aria-hidden="true" />
        <span>Starting language server</span>
      </div>
      <div v-else-if="status === 'error'" class="ide-state error" role="alert">
        <CircleAlert :size="24" aria-hidden="true" />
        <strong>Language server stopped</strong>
        <span>{{ statusDetail || "The browser worker could not start." }}</span>
        <button type="button" @click="restartSession">Retry</button>
      </div>
    </main>

    <section class="bottom-pane" aria-label="Language server results">
      <div class="panel-tabs" role="tablist" aria-label="Result panels">
        <button
          type="button"
          role="tab"
          id="ide-tab-problems"
          aria-controls="ide-panel-problems"
          :aria-selected="activePanel === 'problems'"
          :class="{ active: activePanel === 'problems' }"
          @click="activePanel = 'problems'"
        >
          <CircleAlert :size="14" aria-hidden="true" />
          <span>Problems</span>
          <span class="tab-count">{{ problems.length }}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="ide-tab-output"
          aria-controls="ide-panel-output"
          :aria-selected="activePanel === 'output'"
          :class="{ active: activePanel === 'output' }"
          @click="activePanel = 'output'"
        >
          <Play :size="14" aria-hidden="true" />
          <span>Output</span>
        </button>
        <button
          type="button"
          role="tab"
          id="ide-tab-symbols"
          aria-controls="ide-panel-symbols"
          :aria-selected="activePanel === 'symbols'"
          :class="{ active: activePanel === 'symbols' }"
          @click="activePanel = 'symbols'"
        >
          <ListTree :size="14" aria-hidden="true" />
          <span>Symbols</span>
          <span class="tab-count">{{ symbols.length }}</span>
        </button>
      </div>

      <div
        v-if="activePanel === 'problems'"
        id="ide-panel-problems"
        class="panel-content"
        role="tabpanel"
        aria-labelledby="ide-tab-problems"
      >
        <div v-if="problems.length === 0" class="panel-empty">
          <CircleCheck :size="18" aria-hidden="true" />
          <span>No problems</span>
        </div>
        <button
          v-for="problem in problems"
          v-else
          :key="`${problem.name}:${problem.diagnostic.range.start.line}:${problem.diagnostic.range.start.character}:${problem.diagnostic.message}`"
          class="problem-row"
          type="button"
          @click="reveal(problem.name, problem.diagnostic.range)"
        >
          <CircleAlert
            :size="15"
            :class="problem.diagnostic.severity === 1 ? 'severity-error' : 'severity-warning'"
            aria-hidden="true"
          />
          <span class="problem-message">{{ diagnosticLabel(problem.diagnostic) }}</span>
          <span class="problem-location">
            {{ problem.name }}:{{ problem.diagnostic.range.start.line + 1 }}:{{ problem.diagnostic.range.start.character + 1 }}
          </span>
          <span class="sr-only">{{ diagnosticKind(problem.diagnostic) }}</span>
        </button>
      </div>

      <div
        v-else-if="activePanel === 'output'"
        id="ide-panel-output"
        class="panel-content output-content"
        role="tabpanel"
        aria-labelledby="ide-tab-output"
      >
        <div v-if="evaluation === undefined" class="panel-empty">
          <Play :size="18" aria-hidden="true" />
          <span>No output</span>
        </div>
        <template v-else>
          <div v-if="evaluation.error" class="output-error">{{ evaluation.error }}</div>
          <div v-for="blocker in evaluation.blockers" :key="blocker" class="output-error">
            {{ blocker }}
          </div>
          <div
            v-for="(diagnostic, index) in evaluation.diagnostics"
            :key="`${index}:${diagnostic.message}`"
            class="output-error"
          >
            {{ diagnostic.message }}
          </div>
          <div v-for="(query, index) in evaluation.queries" :key="index" class="output-group">
            <code>{{ query.query }}</code>
            <span class="output-arrow">→</span>
            <code>[{{ query.results.join(", ") }}]</code>
          </div>
          <pre v-if="evaluation.stdout" class="output-stream">{{ evaluation.stdout }}</pre>
          <pre v-if="evaluation.stderr" class="output-stream error">{{ evaluation.stderr }}</pre>
          <div v-if="evaluation.truncated" class="output-notice">
            Output truncated by guard limits.
          </div>
          <div
            v-if="
              evaluation.queries.length === 0 &&
              !evaluation.error &&
              evaluation.blockers.length === 0 &&
              evaluation.diagnostics.length === 0
            "
            class="panel-empty"
          >
            <span>No queries</span>
          </div>
        </template>
      </div>

      <div
        v-else
        id="ide-panel-symbols"
        class="panel-content"
        role="tabpanel"
        aria-labelledby="ide-tab-symbols"
      >
        <div v-if="symbols.length === 0" class="panel-empty">
          <ListTree :size="18" aria-hidden="true" />
          <span>No symbols</span>
        </div>
        <button
          v-for="(symbol, index) in symbols"
          v-else
          :key="`${symbol.name}:${index}`"
          class="symbol-row"
          type="button"
          :style="{ paddingLeft: `${12 + symbol.depth * 16}px` }"
          @click="reveal(activeName, symbol.range)"
        >
          <span class="symbol-name">{{ symbol.name }}</span>
          <span class="symbol-detail">{{ symbol.detail }}</span>
        </button>
      </div>
    </section>

    <footer class="ide-statusbar">
      <span :class="{ 'is-notice': statusNotice }" role="status" aria-live="polite">
        {{ statusNotice || activeName }}
      </span>
      <span>Ln {{ line }}, Col {{ column }}</span>
      <span class="status-diagnostics">
        <CircleAlert :size="12" aria-hidden="true" /> {{ errorCount }}
        <TriangleAlert :size="12" class="warning-mark" aria-hidden="true" /> {{ warningCount }}
      </span>
      <span>Browser</span>
    </footer>

    <dialog ref="fileDialog" class="file-dialog" @cancel="closeDialog">
      <form method="dialog" @submit.prevent="submitDialog">
        <div class="dialog-heading">
          <strong>{{ dialogTitle }}</strong>
          <button class="icon-button compact" type="button" title="Close" aria-label="Close" @click="closeDialog">
            <X :size="16" aria-hidden="true" />
          </button>
        </div>
        <label v-if="dialogMode === 'create' || dialogMode === 'rename'">
          <span>File name</span>
          <input ref="fileNameInput" v-model="dialogName" autocomplete="off" spellcheck="false" />
        </label>
        <p v-else-if="dialogMode === 'delete'">Delete <code>{{ dialogTarget }}</code>?</p>
        <p v-else>Restore the example files?</p>
        <p v-if="dialogError" class="dialog-error" role="alert">{{ dialogError }}</p>
        <div class="dialog-actions">
          <button type="button" class="secondary-command" @click="closeDialog">Cancel</button>
          <button
            type="submit"
            class="primary-command"
            :class="{ danger: dialogMode === 'delete' || dialogMode === 'reset' }"
          >
            {{ dialogAction }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.browser-ide-shell {
  --ide-toolbar-height: 48px;
  display: grid;
  grid-template-columns: 218px minmax(0, 1fr);
  grid-template-rows: var(--ide-toolbar-height) minmax(360px, 1fr) 210px 25px;
  width: 100%;
  height: max(720px, calc(100dvh - var(--vp-nav-height) - 32px));
  max-height: 900px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgb(8 50 104 / 12%);
}

.ide-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 0 10px 0 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.ide-product,
.ide-actions,
.ide-connection,
.file-actions,
.dialog-heading,
.dialog-actions,
.status-diagnostics {
  display: flex;
  align-items: center;
}

.ide-product {
  gap: 9px;
  min-width: 0;
}

.ide-product img {
  flex: 0 0 auto;
  border-radius: 4px;
}

.ide-product strong {
  white-space: nowrap;
  font-size: 14px;
}

.ide-connection {
  gap: 5px;
  min-width: 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
  white-space: nowrap;
}

.ide-connection.is-ready {
  color: #16845b;
}

.dark .ide-connection.is-ready {
  color: #5fcf9d;
}

.ide-connection.is-error {
  color: var(--vp-c-danger-1);
}

.ide-actions {
  justify-content: flex-end;
  gap: 4px;
}

.icon-button,
.run-button,
.panel-tabs button,
.file-select,
.problem-row,
.symbol-row,
.reset-workspace,
.primary-command,
.secondary-command {
  border: 0;
  font: inherit;
  cursor: pointer;
}

.icon-button {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--vp-c-text-2);
  background: transparent;
  border-radius: 4px;
}

.icon-button:hover:not(:disabled),
.icon-button:focus-visible {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-mute);
}

.icon-button.compact {
  width: 26px;
  height: 26px;
}

.icon-button.danger:hover:not(:disabled),
.icon-button.danger:focus-visible {
  color: var(--vp-c-danger-1);
}

button:disabled {
  cursor: default;
  opacity: 0.42;
}

.run-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 76px;
  height: 32px;
  margin-left: 4px;
  padding: 0 13px;
  color: var(--vp-c-white);
  background: #087f8c;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
}

.run-button:hover:not(:disabled),
.run-button:focus-visible {
  background: #006f7a;
}

.file-pane {
  grid-column: 1;
  grid-row: 2 / 4;
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr) 38px;
  min-width: 0;
  background: var(--vp-c-bg-soft);
  border-right: 1px solid var(--vp-c-divider);
}

.pane-heading,
.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 0 10px 0 12px;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.file-list {
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}

.file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 31px;
}

.file-row.active {
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  box-shadow: inset 2px 0 var(--vp-c-brand-1);
}

.file-select {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 31px;
  padding: 0 4px 0 13px;
  color: var(--vp-c-text-2);
  background: transparent;
  text-align: left;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.file-select span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row.active .file-select {
  color: var(--vp-c-text-1);
}

.file-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  background: #ff9f2f;
  border-radius: 2px;
}

.file-actions {
  gap: 0;
  padding-right: 4px;
  opacity: 0;
}

.file-row:hover .file-actions,
.file-row:focus-within .file-actions,
.file-row.active .file-actions {
  opacity: 1;
}

.reset-workspace {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 0 12px;
  color: var(--vp-c-text-3);
  background: transparent;
  border-top: 1px solid var(--vp-c-divider);
  font-size: 12px;
}

.reset-workspace:hover,
.reset-workspace:focus-visible {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-mute);
}

.editor-pane {
  position: relative;
  grid-column: 2;
  grid-row: 2;
  display: grid;
  grid-template-rows: 32px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--vp-code-block-bg);
}

.editor-heading {
  padding: 0 13px;
  background: var(--vp-c-bg);
  text-transform: none;
}

.editor-file {
  min-width: 0;
  overflow: hidden;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-language {
  flex: 0 0 auto;
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.editor-host {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.ide-state {
  position: absolute;
  inset: 32px 0 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--vp-code-block-bg) 94%, transparent);
  text-align: center;
  font-size: 13px;
}

.ide-state.error {
  color: var(--vp-c-danger-1);
}

.ide-state.error span {
  max-width: 460px;
  color: var(--vp-c-text-2);
  overflow-wrap: anywhere;
}

.ide-state button {
  padding: 5px 16px;
  color: var(--vp-c-white);
  background: var(--vp-c-brand-1);
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 600;
}

.bottom-pane {
  grid-column: 2;
  grid-row: 3;
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  background: var(--vp-c-bg);
  border-top: 1px solid var(--vp-c-divider);
}

.panel-tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
  padding: 0 8px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.panel-tabs button {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 8px;
  color: var(--vp-c-text-3);
  background: transparent;
  font-size: 12px;
}

.panel-tabs button.active {
  color: var(--vp-c-text-1);
}

.panel-tabs button.active::after {
  position: absolute;
  right: 6px;
  bottom: -1px;
  left: 6px;
  height: 2px;
  content: "";
  background: var(--vp-c-brand-1);
}

.tab-count {
  min-width: 18px;
  padding: 0 5px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-mute);
  border-radius: 7px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.panel-content {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.panel-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100%;
  padding: 16px;
  color: var(--vp-c-text-3);
  font-size: 12px;
}

.problem-row,
.symbol-row {
  display: grid;
  align-items: center;
  width: 100%;
  min-height: 31px;
  padding: 5px 12px;
  color: var(--vp-c-text-2);
  background: transparent;
  border-bottom: 1px solid color-mix(in srgb, var(--vp-c-divider) 65%, transparent);
  text-align: left;
  font-size: 12px;
}

.problem-row {
  grid-template-columns: 18px minmax(0, 1fr) auto;
  gap: 7px;
}

.problem-row:hover,
.problem-row:focus-visible,
.symbol-row:hover,
.symbol-row:focus-visible {
  background: var(--vp-c-bg-soft);
}

.problem-message,
.problem-location,
.symbol-name,
.symbol-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-location,
.symbol-detail {
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
}

.severity-error {
  color: #d94c4c;
}

.severity-warning {
  color: #d68120;
}

.symbol-row {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.symbol-name {
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
}

.output-content {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.output-group {
  display: grid;
  grid-template-columns: minmax(120px, auto) 20px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.output-group code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--vp-c-text-1);
}

.output-group code:last-child {
  color: var(--vp-c-brand-1);
}

.output-arrow {
  color: var(--vp-c-text-3);
  text-align: center;
}

.output-error,
.output-stream,
.output-notice {
  margin: 0;
  padding: 8px 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border-bottom: 1px solid var(--vp-c-divider);
}

.output-error,
.output-stream.error {
  color: var(--vp-c-danger-1);
}

.output-notice {
  color: var(--metta-code-accent);
}

.ide-statusbar {
  grid-column: 1 / -1;
  grid-row: 4;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  min-width: 0;
  padding: 0 10px;
  color: #eaf7f8;
  background: #087f8c;
  font-size: 11px;
}

.ide-statusbar > span:first-child {
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ide-statusbar > span.is-notice {
  font-weight: 600;
}

.status-diagnostics {
  gap: 3px;
}

.warning-mark {
  margin-left: 5px;
}

.file-dialog {
  width: min(420px, calc(100vw - 32px));
  padding: 0;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: 0 18px 60px rgb(0 0 0 / 28%);
}

.file-dialog::backdrop {
  background: rgb(0 0 0 / 46%);
}

.file-dialog form {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.dialog-heading {
  justify-content: space-between;
  gap: 12px;
}

.file-dialog label {
  display: grid;
  gap: 7px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
}

.file-dialog input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  outline: none;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
}

.file-dialog input:focus {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--vp-c-brand-1) 20%, transparent);
}

.file-dialog p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
}

.file-dialog .dialog-error {
  color: var(--vp-c-danger-1);
}

.dialog-actions {
  justify-content: flex-end;
  gap: 8px;
}

.primary-command,
.secondary-command {
  min-width: 76px;
  height: 32px;
  padding: 0 13px;
  border-radius: 5px;
  font-size: 13px;
  font-weight: 600;
}

.primary-command {
  color: var(--vp-c-white);
  background: var(--vp-c-brand-1);
}

.primary-command.danger {
  background: var(--vp-c-danger-1);
}

.secondary-command {
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.spin {
  animation: ide-spin 0.9s linear infinite;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes ide-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .browser-ide-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 46px minmax(390px, 1fr) 220px 25px;
    height: 830px;
    max-height: none;
  }

  .ide-toolbar {
    grid-column: 1;
    flex-wrap: wrap;
    min-height: 82px;
    padding: 8px;
  }

  .ide-product {
    flex: 1 1 180px;
  }

  .ide-actions {
    flex: 1 1 auto;
  }

  .file-pane {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    border-right: 0;
    border-bottom: 1px solid var(--vp-c-divider);
    overflow-x: auto;
  }

  .pane-heading,
  .reset-workspace {
    flex: 0 0 auto;
    border: 0;
  }

  .reset-workspace {
    justify-content: center;
    width: 38px;
    padding: 0;
  }

  .pane-heading > span,
  .reset-workspace span {
    display: none;
  }

  .file-list {
    display: flex;
    flex: 1 0 auto;
    padding: 0;
    overflow: visible;
  }

  .file-row {
    display: flex;
    flex: 0 0 auto;
    border-right: 1px solid var(--vp-c-divider);
  }

  .file-row.active {
    box-shadow: inset 0 -2px var(--vp-c-brand-1);
  }

  .file-select {
    max-width: 180px;
  }

  .file-actions {
    display: flex;
    opacity: 1;
  }

  .editor-pane {
    grid-column: 1;
    grid-row: 3;
  }

  .bottom-pane {
    grid-column: 1;
    grid-row: 4;
  }

  .ide-statusbar {
    grid-column: 1;
    grid-row: 5;
  }

  .problem-row {
    grid-template-columns: 18px minmax(0, 1fr);
  }

  .problem-location {
    grid-column: 2;
  }

  .output-group {
    grid-template-columns: minmax(0, 1fr);
  }

  .output-arrow {
    display: none;
  }
}

@media (max-width: 470px) {
  .ide-connection span,
  .editor-language,
  .ide-actions .icon-button:nth-child(-n + 2) {
    display: none;
  }

  .ide-actions {
    justify-content: flex-end;
  }

  .run-button {
    min-width: 68px;
  }

  .panel-tabs {
    padding: 0 3px;
  }

  .panel-tabs button {
    padding: 0 5px;
  }

  .ide-statusbar {
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin {
    animation-duration: 1.8s;
  }
}
</style>

<style>
.cm-metta-semantic-comment {
  color: var(--mh-comment);
}
.cm-metta-semantic-string {
  color: var(--mh-string);
}
.cm-metta-semantic-number {
  color: var(--mh-number);
}
.cm-metta-semantic-variable,
.cm-metta-semantic-parameter {
  color: var(--mh-var);
}
.cm-metta-semantic-namespace {
  color: var(--mh-at);
}
.cm-metta-semantic-type,
.cm-metta-semantic-class,
.cm-metta-semantic-interface,
.cm-metta-semantic-struct {
  color: var(--mh-type);
}
.cm-metta-semantic-keyword,
.cm-metta-semantic-operator,
.cm-metta-semantic-macro,
.cm-metta-semantic-mettaControlFlow,
.cm-metta-semantic-mettaBinding,
.cm-metta-semantic-mettaPattern,
.cm-metta-semantic-mettaModule,
.cm-metta-semantic-mettaEvaluation,
.cm-metta-semantic-mettaQuote,
.cm-metta-semantic-mettaArithmeticOperator,
.cm-metta-semantic-mettaComparisonOperator,
.cm-metta-semantic-mettaLogicalOperator {
  color: var(--mh-op);
}
.cm-metta-semantic-mettaTypeOperator {
  color: var(--mh-type);
}
.cm-metta-semantic-function,
.cm-metta-semantic-method,
.cm-metta-semantic-mettaEffect,
.cm-metta-semantic-mettaMathFunction,
.cm-metta-semantic-mettaCollectionFunction,
.cm-metta-semantic-mettaPredicateFunction,
.cm-metta-semantic-mettaAssertion {
  color: var(--vp-c-brand-1);
}
</style>
