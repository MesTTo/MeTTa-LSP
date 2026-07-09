import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

import {
  type GuardedEvaluationParams,
  GuardedEvaluationRequest,
  type GuardedEvaluationResultPayload,
  IndexStatsRequest,
  type IndexStatsResult,
  SideEffectPolicyRequest,
  type SideEffectPolicyResult,
  type TraceParams,
  TraceRequest,
  type TraceResultPayload,
} from "../server/shared/lspRequests.js";
import { registerTestController } from "./testController.js";

let client: LanguageClient | undefined;
let output: vscode.LogOutputChannel | undefined;
let runOutput: vscode.OutputChannel | undefined;
let traceOutput: vscode.OutputChannel | undefined;

interface LspPosition {
  readonly line: number;
  readonly character: number;
}
interface LspLocation {
  readonly uri: string;
  readonly range: { readonly start: LspPosition; readonly end: LspPosition };
}

function toLocation(location: LspLocation): vscode.Location {
  return new vscode.Location(
    vscode.Uri.parse(location.uri),
    new vscode.Range(
      new vscode.Position(location.range.start.line, location.range.start.character),
      new vscode.Position(location.range.end.line, location.range.end.character),
    ),
  );
}

function lspRange(selection: vscode.Selection): GuardedEvaluationParams["range"] {
  return {
    start: { line: selection.start.line, character: selection.start.character },
    end: { line: selection.end.line, character: selection.end.character },
  };
}

function mettaUri(explicit?: string): string | undefined {
  const editor = vscode.window.activeTextEditor;
  return (
    explicit ??
    (editor && editor.document.languageId === "metta" ? editor.document.uri.toString() : undefined)
  );
}

function renderEvaluation(result: GuardedEvaluationResultPayload): string {
  const lines: string[] = [];
  lines.push(`Guarded evaluation: ${result.ok ? "ok" : "blocked/failed"}`);
  lines.push(
    `engine=${result.engine} stateless=${result.stateless} elapsedMs=${result.elapsedMs} hash=${result.sourceHash.slice(0, 12)}`,
  );
  if (result.blockers.length > 0) {
    lines.push("\nNot evaluated:");
    for (const blocker of result.blockers) lines.push(`- ${blocker}`);
  }
  if (result.error) lines.push(`\nError: ${result.error}`);
  if (result.stdout) lines.push(`\nCaptured output:\n${result.stdout}`);
  if (result.queries.length > 0) {
    lines.push("\nQueries:");
    for (const query of result.queries) {
      lines.push(`- ${query.query}`);
      for (const value of query.results) lines.push(`  => ${value}`);
      if (query.truncated) lines.push(`  ... truncated (${query.resultCount} total)`);
    }
  }
  if (result.truncated) lines.push("\nResult was truncated by guard limits.");
  return lines.join("\n");
}

// Clean MeTTa-shaped output for the coloured Run channel: each query as a comment, its results as atoms.
function renderRun(result: GuardedEvaluationResultPayload): string {
  const lines: string[] = [];
  for (const query of result.queries) {
    lines.push(`; ${query.query}`);
    if (query.results.length === 0) lines.push("; (no results)");
    else for (const value of query.results) lines.push(value);
  }
  if (result.stdout) lines.push(result.stdout.trimEnd());
  if (result.error !== undefined) lines.push(`; error: ${result.error}`);
  if (result.blockers.length > 0) lines.push(...result.blockers.map((blocker) => `; ${blocker}`));
  if (result.python === "unavailable") {
    lines.push("; Python interop unavailable: npm install pythonia (and python3 on PATH)");
  }
  return lines.join("\n");
}

function renderTrace(result: TraceResultPayload): string {
  const lines: string[] = [`; trace ${result.query}`];
  if (!result.ok) {
    lines.push(`; error: ${result.error ?? "unknown error"}`);
    return lines.join("\n");
  }
  result.steps.forEach((step, index) => {
    lines.push(`; step ${index}`);
    if (step.length === 0) lines.push("; (no atoms)");
    else lines.push(...step);
  });
  if (result.truncated) lines.push("; trace truncated at the configured step limit");
  if (result.final.length > 0) {
    lines.push("; final");
    lines.push(...result.final);
  }
  return lines.join("\n");
}

// The visualise webview shell: an empty stage the bundled MeTTaGrapher script (dist/webview/visualise.js)
// fills. Strict CSP — only the nonced bundle runs, images allow data: URLs because the GIF exporter
// rasterizes SVG frames through them, and styles are inline below, themed on VS Code's variables.
function visualiseHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  payload: { source: string; title: string },
): string {
  const nonce = Buffer.from(
    Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)),
  ).toString("base64");
  const data = JSON.stringify(payload).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<title>${payload.title.replaceAll("<", "&lt;")}</title>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="metta-source">${data}</script>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

// The settings the quick-pick toggles. Every one is a real VS Code boolean setting (so it syncs and can
// also be changed in the Settings UI); the quick-pick is just a fast toggle surface.
const SETTING_TOGGLES: readonly { readonly key: string; readonly label: string }[] = [
  { key: "inlayHints.enabled", label: "Inlay hints" },
  { key: "pseudocode.enabled", label: "Pseudocode mode" },
  { key: "diagnostics.lint", label: "Lint diagnostics" },
  { key: "diagnostics.prolog", label: "Prolog diagnostics" },
  { key: "diagnostics.semanticLint", label: "Semantic lint" },
  { key: "diagnostics.arity", label: "Arity diagnostics" },
  { key: "diagnostics.typeMismatch", label: "Type-mismatch diagnostics" },
  { key: "hover.userDefinitionComments", label: "Doc comments in hovers" },
  { key: "completion.autoImports", label: "Auto-imports in completion" },
  { key: "completion.includeSnippets", label: "Snippet completions" },
];

interface SettingItem extends vscode.QuickPickItem {
  readonly key: string;
  readonly value: boolean;
}

// Show the MeTTa settings quick-pick: each toggle with its current state, plus an entry into the full
// Settings UI. Toggling flips the VS Code setting and reopens the pick so several can be flipped in a row.
async function showSettingsQuickPick(): Promise<void> {
  const config = vscode.workspace.getConfiguration("metta");
  const items: SettingItem[] = SETTING_TOGGLES.map((toggle) => {
    const on = config.get<boolean>(toggle.key) === true;
    return {
      key: toggle.key,
      value: on,
      label: `$(${on ? "check" : "circle-large-outline"}) ${toggle.label}`,
      description: on ? "on" : "off",
    };
  });
  const openSettings: SettingItem = {
    key: "__open__",
    value: false,
    label: "$(gear) Open MeTTa Settings…",
    description: "the full Settings UI",
  };
  const pick = await vscode.window.showQuickPick([...items, openSettings], {
    title: "MeTTa settings",
    placeHolder: "Toggle a setting (changes are saved to your VS Code settings)",
  });
  if (!pick) return;
  if (pick.key === "__open__") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:local.metta-ts-lsp",
    );
    return;
  }
  await config.update(pick.key, !pick.value, vscode.ConfigurationTarget.Global);
  await showSettingsQuickPick();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const serverModule = context.asAbsolutePath(path.join("dist", "server", "server.js"));
  output = vscode.window.createOutputChannel("MeTTa Language Server", { log: true });
  // Run results are MeTTa text, so this channel is language-bound and the editor colours it with the
  // shipped grammar; the log channel above keeps the LSP trace.
  runOutput = vscode.window.createOutputChannel("MeTTa Run", "metta");
  traceOutput = vscode.window.createOutputChannel("MeTTa Trace", "metta");
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "metta" },
      { scheme: "untitled", language: "metta" },
    ],
    synchronize: {
      configurationSection: "metta",
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{metta,pl}"),
    },
    outputChannel: output,
  };

  client = new LanguageClient("mettaTsLsp", "MeTTa LSP", serverOptions, clientOptions);

  context.subscriptions.push(
    output,
    runOutput,
    traceOutput,
    // Resolve the debugged file's imports (via the server) into the launch config, so a cross-file query
    // debugs against them. The debug adapter cannot resolve imports itself: it must not reach the server.
    vscode.debug.registerDebugConfigurationProvider("metta", {
      async resolveDebugConfiguration(_folder, config) {
        if (typeof config.program === "string" && client) {
          const uri = vscode.Uri.file(config.program).toString();
          config.imports = await client.sendRequest("metta/imports", { uri });
        }
        return config;
      },
    }),
    vscode.commands.registerCommand("metta.restartServer", async () => {
      if (!client) return;
      await client.stop();
      await client.start();
      void vscode.window.showInformationMessage("MeTTa language server restarted.");
    }),
    vscode.commands.registerCommand("metta.showIndexStats", async () => {
      const stats = await client?.sendRequest<IndexStatsResult>(IndexStatsRequest);
      if (!stats) return;
      void vscode.window.showInformationMessage(
        `MeTTa index: ${stats.files} files, ${stats.definitions} definitions, ${stats.symbols} symbols, ${stats.imports} imports.`,
      );
    }),
    vscode.commands.registerCommand("metta.showSideEffectPolicy", async () => {
      const policy = await client?.sendRequest<SideEffectPolicyResult>(SideEffectPolicyRequest);
      if (!policy) return;
      void vscode.window.showInformationMessage(policy.note);
    }),
    vscode.commands.registerCommand("metta.evaluateGuarded", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "metta" || !client) return;
      const selection = editor.selection;
      const params: GuardedEvaluationParams = {
        uri: editor.document.uri.toString(),
        range: selection.isEmpty ? undefined : lspRange(selection),
        includePriorDefinitions: true,
      };
      const result = await client.sendRequest<GuardedEvaluationResultPayload>(
        GuardedEvaluationRequest,
        params,
      );
      output?.appendLine("\n--- MeTTa guarded evaluation ---");
      output?.appendLine(renderEvaluation(result));
      output?.show(true);
      void vscode.window.showInformationMessage(
        result.ok
          ? "MeTTa guarded evaluation completed."
          : "MeTTa guarded evaluation blocked or failed.",
      );
    }),
    vscode.commands.registerCommand("metta.organizeImports", async () => {
      await vscode.commands.executeCommand("editor.action.organizeImports");
    }),
    vscode.commands.registerCommand(
      "metta.run",
      async (arg?: { uri?: string; range?: GuardedEvaluationParams["range"] }) => {
        const uri = mettaUri(arg?.uri);
        if (uri === undefined || !client) return;
        const result = await client.sendRequest<GuardedEvaluationResultPayload>("metta/run", {
          uri,
          range: arg?.range,
        });
        runOutput?.appendLine(renderRun(result));
        runOutput?.show(true);
        if (!result.ok && result.error !== undefined) {
          void vscode.window.showWarningMessage(`MeTTa run: ${result.error}`);
        }
      },
    ),
    vscode.commands.registerCommand(
      "metta.trace",
      async (arg?: { uri?: string; range?: TraceParams["range"] }) => {
        const uri = mettaUri(arg?.uri);
        if (uri === undefined || !client) return;
        const result = await client.sendRequest<TraceResultPayload>(TraceRequest, {
          uri,
          range: arg?.range,
        });
        traceOutput?.appendLine(renderTrace(result));
        traceOutput?.show(true);
        if (!result.ok) {
          void vscode.window.showWarningMessage(`MeTTa trace: ${result.error ?? "trace failed"}`);
        }
      },
    ),
    vscode.commands.registerCommand(
      "metta.showReferences",
      (arg: { uri: string; position: LspPosition; locations: readonly LspLocation[] }) => {
        void vscode.commands.executeCommand(
          "editor.action.showReferences",
          vscode.Uri.parse(arg.uri),
          new vscode.Position(arg.position.line, arg.position.character),
          arg.locations.map(toLocation),
        );
      },
    ),
    vscode.commands.registerCommand("metta.visualise", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "metta") return;
      // No prompt: a non-empty selection is visualised on its own, otherwise the whole file loads into
      // the grapher, which reduces the file's own query — the same interactive component the metta-ts
      // site embeds, bundled into the webview.
      const selection = editor.document.getText(editor.selection).trim();
      const source = selection.length > 0 ? selection : editor.document.getText();
      const title = `${path.basename(editor.document.fileName)} — MeTTa reduction`;
      const panel = vscode.window.createWebviewPanel(
        "mettaVisualise",
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist", "webview")],
        },
      );
      panel.webview.html = visualiseHtml(
        panel.webview,
        panel.webview.asWebviewUri(
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "visualise.js"),
        ),
        { source, title },
      );
      panel.webview.onDidReceiveMessage(
        async (message: { type?: string; name?: string; base64?: string }) => {
          if (message.type !== "saveGif" || message.base64 === undefined) return;
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
          const target = await vscode.window.showSaveDialog({
            filters: { GIF: ["gif"] },
            defaultUri: folder
              ? vscode.Uri.joinPath(folder, message.name ?? "reduction.gif")
              : undefined,
          });
          if (!target) return;
          await vscode.workspace.fs.writeFile(target, Buffer.from(message.base64, "base64"));
          void vscode.window.showInformationMessage(`Saved ${target.fsPath}`);
        },
        undefined,
        context.subscriptions,
      );
    }),
    vscode.commands.registerCommand(
      "metta.explainForm",
      async (arg?: { uri?: string; position?: LspPosition }) => {
        const editor = vscode.window.activeTextEditor;
        const uri = mettaUri(arg?.uri);
        if (uri === undefined || !client) return;
        const active = arg?.position ?? {
          line: editor?.selection.active.line ?? 0,
          character: editor?.selection.active.character ?? 0,
        };
        const explanation = await client.sendRequest<{ text: string } | null>("metta/explainForm", {
          uri,
          position: active,
        });
        if (!explanation) return;
        void vscode.window.showInformationMessage(explanation.text);
      },
    ),
    vscode.commands.registerCommand("metta.runChecks", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
      void vscode.window.showInformationMessage(
        `MeTTa: ${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"} in this file.`,
      );
    }),
    vscode.commands.registerCommand("metta.settings", () => showSettingsQuickPick()),
  );

  // A status-bar button next to the language indicator that opens the settings quick-pick, shown only
  // while a MeTTa file is active.
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = "$(settings-gear) MeTTa";
  statusBar.tooltip = "MeTTa settings — toggle inlay hints, pseudocode, diagnostics…";
  statusBar.command = "metta.settings";
  const syncStatusBar = (): void => {
    if (vscode.window.activeTextEditor?.document.languageId === "metta") statusBar.show();
    else statusBar.hide();
  };
  syncStatusBar();
  context.subscriptions.push(statusBar, vscode.window.onDidChangeActiveTextEditor(syncStatusBar));

  registerTestController(context, () => client);

  // Serve the generated stdlib reference (metta://stdlib/….metta) as read-only documents, so Go to Definition
  // on a builtin opens a page with its declaration and documentation. The server generates the content.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("metta", {
      provideTextDocumentContent: async (uri) =>
        (await client?.sendRequest<string | null>("metta/stdlibDocument", {
          uri: uri.toString(),
        })) ?? "",
    }),
  );

  context.subscriptions.push(client);
  await client.start();
}

export async function deactivate(): Promise<void> {
  if (!client) return;
  await client.stop();
  client = undefined;
  output = undefined;
  runOutput = undefined;
  traceOutput = undefined;
}
