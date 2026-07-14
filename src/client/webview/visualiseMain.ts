// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The visualise webview: the same interactive MeTTaGrapher the metta-ts site embeds, driven by plain DOM
// instead of Vue. The whole engine is pure TypeScript, bundled into this one script, so the editor's
// document is loaded, evaluated, stepped, and exported without leaving the webview. The control surface
// mirrors the site's component: a Play button starts a step-through of the file's query, Prev/Next/speed
// walk it, Graph/Blocks switch views, and Export GIF hands the encoded reduction back to the extension
// host to save. The grapher owns all view state; this shell only mirrors uiState() into the controls.

import { type BlockPalette, MeTTaGrapher } from "@metta-ts/grapher";
import * as gifenc from "gifenc";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();

interface SourcePayload {
  readonly source: string;
  readonly title: string;
}

function payload(): SourcePayload {
  const tag = document.getElementById("metta-source");
  const parsed: unknown = JSON.parse(tag?.textContent ?? "{}");
  const record = (parsed ?? {}) as Partial<SourcePayload>;
  return { source: record.source ?? "", title: record.title ?? "reduction" };
}

// The site's speed model: the slider sets the step delay, and the morph fills most of each step so a
// slow speed is watchable. setTraceDuration keeps the live morph and the GIF export on the same span.
let speed = 5; // 1 (slow) .. 10 (fast)
const delayMs = (): number => 1150 - speed * 100;
const morphMs = (): number => Math.round(delayMs() * 0.85);

// The whole look lives here with the behaviour, so the extension shell stays a bare CSP mount point and
// any host (webview, browser harness) renders identically: the site's component styling, on VS Code's
// theme variables with the metta-ts dark palette as the fallback.
const STYLE = `
  html, body, #app { margin: 0; height: 100%; }
  body { font-family: var(--vscode-font-family, system-ui, sans-serif);
    color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-editor-background, #1e1e1e); }
  #app { display: flex; flex-direction: column;
    --metta-grapher-canvas: var(--vscode-editor-background, #1b1d23);
    --metta-grapher-surface: var(--vscode-editorWidget-background, #21262d);
    --metta-grapher-surface-alt: var(--vscode-input-background, #2b313b);
    --metta-grapher-border: var(--vscode-panel-border, #3d444d);
    --metta-grapher-foreground: var(--vscode-editor-foreground, #e6edf3);
    --metta-grapher-muted: var(--vscode-descriptionForeground, #9ca3af);
    --metta-grapher-link: var(--vscode-textLink-foreground, #79c0ff);
    --metta-grapher-string: var(--vscode-terminal-ansiGreen, #a5d6ff);
    --metta-grapher-operator: var(--vscode-errorForeground, #ff7b72);
    --metta-grapher-accent: var(--vscode-focusBorder, #f2cc60);
    --metta-grapher-purple: var(--vscode-terminal-ansiMagenta, #d2a8ff);
    --metta-grapher-cyan: var(--vscode-terminal-ansiCyan, #39c5cf);
    --metta-grapher-token-text: var(--vscode-editor-background, #0d1117); }
  .stage { position: relative; flex: 1 1 auto; min-height: 260px; overflow: clip; }
  .canvas { width: 100%; height: 100%; position: relative; overflow: clip; }
  .canvas .mg-svg { background: var(--metta-grapher-canvas) !important;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace); }
  .canvas .mg-var-link { stroke: var(--metta-grapher-accent); }
  .canvas .mg-node .box { stroke: var(--metta-grapher-border); }
  .canvas .mg-node .box[fill="#454c5a"],
  .canvas .mg-node .box[fill="#6e7681"] { fill: var(--metta-grapher-surface-alt); }
  .canvas .mg-node .box[fill="#ffa657"] { fill: var(--metta-grapher-accent); }
  .canvas .mg-node .box[fill="#d2a8ff"] { fill: var(--metta-grapher-purple); }
  .canvas .mg-node .box[fill="#79c0ff"] { fill: var(--metta-grapher-link); }
  .canvas .mg-node .box[fill="#a5d6ff"] { fill: var(--metta-grapher-string); }
  .canvas .mg-node .box[fill="#39c5cf"] { fill: var(--metta-grapher-cyan); }
  .canvas .mg-node .box[fill="#ff7b72"] { fill: var(--metta-grapher-operator); }
  .canvas .mg-node .box[fill="#f2cc60"],
  .canvas .mg-node .box[fill="#7ee787"] { fill: var(--metta-grapher-accent); }
  .canvas .mg-node .var[stroke="#ffa657"] { stroke: var(--metta-grapher-accent); }
  .canvas .mg-node text[fill="#e6edf3"] { fill: var(--metta-grapher-foreground); }
  .canvas .mg-node text[fill="#ffa657"] { fill: var(--metta-grapher-accent); }
  .canvas .mg-node text[fill="#0d1117"] { fill: var(--metta-grapher-token-text); }
  .canvas .mg-port { fill: var(--metta-grapher-muted); stroke: var(--metta-grapher-canvas); }
  .canvas .mg-sel { stroke: var(--vscode-focusBorder, #38bdf8); }
  .canvas .mg-sel.primary { stroke: var(--vscode-editorWarning-foreground, #f59e0b); }
  .canvas .mg-result { fill: var(--metta-grapher-muted); }
  .canvas .mg-result.error { fill: var(--vscode-errorForeground, #f87171); }
  .canvas .mg-viz-hi { stroke: var(--metta-grapher-accent); }
  .canvas .mg-viz-label { fill: var(--metta-grapher-accent); }
  button { font: inherit; cursor: pointer; }
  .view { position: absolute; top: 8px; left: 8px; display: flex; gap: 0; z-index: 5;
    border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 6px; overflow: hidden;
    background: var(--vscode-editor-background, #1e1e1e); opacity: 0.92; }
  .view-btn { font-size: 12px; padding: 4px 12px; border: none;
    color: var(--vscode-descriptionForeground, #9d9d9d);
    background: var(--vscode-editor-background, #1e1e1e); }
  .view-btn.active { color: var(--vscode-button-foreground, #ffffff);
    background: var(--vscode-button-background, #0e639c); }
  .zoom { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column;
    gap: 4px; z-index: 5; }
  .zoom button { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
    font-size: 16px; line-height: 1; color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 6px; opacity: 0.85; }
  .zoom button:hover { opacity: 1; }
  .pan { position: absolute; left: 8px; bottom: 8px; display: grid; gap: 2px; z-index: 5;
    grid-template-columns: repeat(3, 24px); grid-template-rows: repeat(3, 24px); }
  .pan button { display: flex; align-items: center; justify-content: center; font-size: 12px;
    line-height: 1; color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c); border-radius: 5px; opacity: 0.8; }
  .pan button:hover { opacity: 1; }
  .pan .up { grid-area: 1 / 2; } .pan .left { grid-area: 2 / 1; }
  .pan .right { grid-area: 2 / 3; } .pan .down { grid-area: 3 / 2; }
  .bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; flex-wrap: wrap;
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-editorWidget-background, #252526); }
  .btn { font-size: 13px; font-weight: 600; padding: 4px 16px; border: none; border-radius: 6px;
    color: var(--vscode-button-foreground, #ffffff);
    background: var(--vscode-button-background, #0e639c); }
  .btn.ghost { color: var(--vscode-foreground, #cccccc);
    background: var(--vscode-editor-background, #1e1e1e);
    border: 1px solid var(--vscode-panel-border, #3c3c3c); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn.icon { display: inline-flex; align-items: center; gap: 5px; }
  .ico { width: 11px; height: 11px; fill: currentColor; }
  .hint { color: var(--vscode-descriptionForeground, #9d9d9d); font-size: 12px; }
  .speed { display: flex; align-items: center; gap: 6px; font-size: 12px;
    color: var(--vscode-descriptionForeground, #9d9d9d); }
  .speed input { width: 90px; }
  .step { font-size: 12px; font-variant-numeric: tabular-nums;
    color: var(--vscode-descriptionForeground, #9d9d9d); }
  .source { margin: 0; padding: 10px 16px; max-height: 20vh; overflow: auto;
    border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace); font-size: 13px;
    color: var(--vscode-descriptionForeground, #9d9d9d); white-space: pre-wrap; }
`;

const styleTag = document.createElement("style");
styleTag.textContent = STYLE;
document.head.append(styleTag);

const app = document.getElementById("app");
if (!app) throw new Error("visualise webview: missing #app");
const root: HTMLElement = app;
root.innerHTML = `
  <div class="stage">
    <div id="canvas" class="canvas"></div>
    <div class="view">
      <button id="view-graph" class="view-btn">Graph</button>
      <button id="view-block" class="view-btn">Blocks</button>
    </div>
    <div class="zoom">
      <button id="zoom-in" title="Zoom in">+</button>
      <button id="zoom-out" title="Zoom out">&minus;</button>
      <button id="fit" title="Fit">&#10530;</button>
    </div>
    <div class="pan">
      <button id="pan-up" class="up" title="Pan up">&#9650;</button>
      <button id="pan-left" class="left" title="Pan left">&#9664;</button>
      <button id="pan-right" class="right" title="Pan right">&#9654;</button>
      <button id="pan-down" class="down" title="Pan down">&#9660;</button>
    </div>
  </div>
  <div id="bar" class="bar"></div>
  <pre id="source" class="source"></pre>
`;

function mustGet(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`visualise webview: missing #${id}`);
  return el;
}
const canvas = mustGet("canvas");
const bar = mustGet("bar");
const sourcePane = mustGet("source");

// panOnLeftDrag: the canvas owns this whole panel rather than sitting in a scrolling article, so a drag
// reads as "move the picture". Shift-drag still rubber-bands, so box-select stays available.
const grapher = new MeTTaGrapher(canvas, { source: payload().source, panOnLeftDrag: true });
// Expose the instance the way the metta-ts site does, so the console (and tests) can drive it:
// document.querySelector(".canvas").grapher
(canvas as HTMLElement & { grapher?: MeTTaGrapher }).grapher = grapher;

interface GrapherTheme {
  readonly canvas: string;
  readonly blockPalette: BlockPalette;
  readonly cssVars: Readonly<Record<string, string>>;
}

function themeVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function vscodeColor(id: string, fallback: string): string {
  return themeVar(`--vscode-${id}`, fallback);
}

function currentGrapherTheme(): GrapherTheme {
  const canvas = vscodeColor("editor-background", "#1b1d23");
  const surface = vscodeColor(
    "editorWidget-background",
    vscodeColor("sideBar-background", "#21262d"),
  );
  const surfaceAlt = vscodeColor("input-background", surface);
  const border = vscodeColor("contrastBorder", vscodeColor("panel-border", "#3d444d"));
  const foreground = vscodeColor("editor-foreground", "#e6edf3");
  const muted = vscodeColor("descriptionForeground", "#9ca3af");
  const link = vscodeColor("textLink-foreground", "#79c0ff");
  const string = vscodeColor("terminal-ansiGreen", link);
  const operator = vscodeColor("errorForeground", "#ff7b72");
  const accent = vscodeColor("focusBorder", vscodeColor("button-background", "#f2cc60"));
  const purple = vscodeColor("terminal-ansiMagenta", accent);
  const cyan = vscodeColor("terminal-ansiCyan", link);
  const tokenText = document.body.classList.contains("vscode-light") ? foreground : canvas;
  return {
    canvas,
    blockPalette: {
      canvas,
      bkgColor: surface,
      backgroundBlockColor: surfaceAlt,
      outlineBlockColor: border,
      formColor: foreground,
      identifierColor: foreground,
      literalColor: link,
      stringColor: string,
      operatorColor: operator,
      spacerefColor: accent,
      atColor: purple,
      holeFill: accent,
      holeSide: accent,
      holeText: vscodeColor("button-foreground", tokenText),
      selectedColor: vscodeColor("focusBorder", accent),
      selectedAtomColor: tokenText,
    },
    cssVars: {
      "--metta-grapher-canvas": canvas,
      "--metta-grapher-surface": surface,
      "--metta-grapher-surface-alt": surfaceAlt,
      "--metta-grapher-border": border,
      "--metta-grapher-foreground": foreground,
      "--metta-grapher-muted": muted,
      "--metta-grapher-link": link,
      "--metta-grapher-string": string,
      "--metta-grapher-operator": operator,
      "--metta-grapher-accent": accent,
      "--metta-grapher-purple": purple,
      "--metta-grapher-cyan": cyan,
      "--metta-grapher-token-text": tokenText,
    },
  };
}

function setGraphBackground(editor: MeTTaGrapher, color: string): void {
  // Grapher exposes block palettes, but its graph background setter is still internal.
  const bridge = editor as unknown as {
    readonly renderer?: { setBackground(color: string): void };
  };
  bridge.renderer?.setBackground(color);
  editor.svg.style.background = color;
}

let activeTheme = currentGrapherTheme();

function applyGrapherTheme(): void {
  activeTheme = currentGrapherTheme();
  for (const [name, value] of Object.entries(activeTheme.cssVars)) {
    root.style.setProperty(name, value);
  }
  grapher.setBlockPalette(activeTheme.blockPalette);
  setGraphBackground(grapher, activeTheme.canvas);
  grapher.render();
}

const themeObserver = new MutationObserver(applyGrapherTheme);
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "data-vscode-theme-id"],
});

type Ui = ReturnType<MeTTaGrapher["uiState"]>;
let ui: Ui = grapher.uiState();

// Auto-play is the only view state the shell owns, because it is a timer, not editor state.
let playing = false;
let timer: ReturnType<typeof setInterval> | undefined;

function atEnd(): boolean {
  const info = grapher.traceInfo();
  return info === null || info.index >= info.total - 1;
}
function pausePlay(): void {
  playing = false;
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}
function startPlay(): void {
  if (atEnd()) return;
  playing = true;
  timer = setInterval(() => {
    if (atEnd()) {
      pausePlay();
      renderBar();
      return;
    }
    grapher.traceForward();
  }, delayMs());
}

function refreshSource(): void {
  sourcePane.textContent = ui.viewMode === "block" ? grapher.blockSource() : grapher.toSource();
}

function button(
  label: string,
  cls: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = cls;
  el.innerHTML = label;
  el.disabled = disabled;
  el.addEventListener("click", onClick);
  return el;
}

const PLAY_ICON = '<svg class="ico" viewBox="0 0 12 12"><path d="M2.5 1.5 11 6 2.5 10.5Z"/></svg>';
const PAUSE_ICON =
  '<svg class="ico" viewBox="0 0 12 12"><rect x="2.5" y="1.5" width="2.6" height="9"/><rect x="6.9" y="1.5" width="2.6" height="9"/></svg>';
const PREV_ICON = '<svg class="ico" viewBox="0 0 12 12"><path d="M9.5 1.5 1 6 9.5 10.5Z"/></svg>';

let exporting = false;

async function exportGif(): Promise<void> {
  if (exporting) return;
  exporting = true;
  renderBar();
  try {
    // The editor paces the export off the trace duration it is playing (setTraceDuration keeps it
    // current); the explicit frame count carries the same span for older grapher builds, and holding
    // each settled state for the rest of the beat makes morph + hold = one slider step.
    const opts = {
      holdMs: Math.max(60, delayMs() - morphMs()),
      framesPerStep: Math.max(1, Math.round(morphMs() / 40)),
      background: activeTheme.canvas,
    };
    const graph = ui.viewMode === "graph";
    const blob = graph
      ? await grapher.exportGraphReductionGif(gifenc, opts)
      : await grapher.exportReductionGif(gifenc, opts);
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      vscode.postMessage({
        type: "saveGif",
        name: graph ? "reduction-graph.gif" : "reduction-blocks.gif",
        base64: btoa(binary),
      });
    }
  } finally {
    exporting = false;
    renderBar();
  }
}

function renderBar(): void {
  bar.replaceChildren();
  const trace = ui.tracing;
  if (trace === null) {
    bar.append(
      button(`${PLAY_ICON} Play`, "btn icon", () => {
        grapher.playTrace();
        startPlay();
      }),
    );
    if (ui.viewMode === "graph") {
      bar.append(button("Evaluate", "btn ghost", () => grapher.evaluateAll()));
      bar.append(
        hint(
          "double-click empty to add a node, drag a node's top dot onto another to connect, double-click a node to evaluate",
        ),
      );
    } else {
      if (ui.blockCanBack) bar.append(button("Back", "btn ghost", () => grapher.blockBack()));
      bar.append(
        hint(
          "double-click a term (or select it and press Enter) to reduce it; click a term and type to edit it",
        ),
      );
    }
    return;
  }
  bar.append(
    button(
      `${PREV_ICON} Prev`,
      "btn ghost icon",
      () => {
        pausePlay();
        grapher.traceBack();
      },
      trace.index === 0,
    ),
    button(
      `Next ${PLAY_ICON}`,
      "btn ghost icon",
      () => {
        pausePlay();
        grapher.traceForward();
      },
      trace.index >= trace.total - 1,
    ),
    button(playing ? `${PAUSE_ICON} Pause` : `${PLAY_ICON} Play`, "btn icon", () => {
      if (playing) {
        pausePlay();
        renderBar();
        return;
      }
      if (atEnd()) grapher.traceRestart();
      startPlay();
      renderBar();
    }),
  );
  const speedWrap = document.createElement("label");
  speedWrap.className = "speed";
  speedWrap.textContent = "speed";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "1";
  slider.max = "10";
  slider.value = String(speed);
  slider.addEventListener("input", () => {
    speed = Number(slider.value);
    grapher.setTraceDuration(morphMs());
    if (playing) {
      pausePlay();
      startPlay();
    }
  });
  speedWrap.append(slider);
  const step = document.createElement("span");
  step.className = "step";
  step.textContent = `step ${trace.index} / ${trace.total - 1}`;
  bar.append(
    speedWrap,
    step,
    button("Reset", "btn ghost", () => {
      pausePlay();
      grapher.stopTrace();
      refreshSource();
    }),
    button(exporting ? "Exporting…" : "Export GIF", "btn ghost", () => void exportGif(), exporting),
  );
}

function hint(text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "hint";
  el.textContent = text;
  return el;
}

function renderViewToggle(): void {
  const graphBtn = document.getElementById("view-graph");
  const blockBtn = document.getElementById("view-block");
  graphBtn?.classList.toggle("active", ui.viewMode === "graph");
  blockBtn?.classList.toggle("active", ui.viewMode === "block");
}

function refreshUi(): void {
  ui = grapher.uiState();
  if (ui.tracing === null) pausePlay();
  renderViewToggle();
  renderBar();
  refreshSource();
}

grapher.onViewChange(refreshUi);
grapher.onChange(() => {
  if (ui.viewMode !== "block") refreshSource();
});
grapher.onBlockChange(() => {
  ui = grapher.uiState();
  renderBar();
  if (ui.viewMode === "block") refreshSource();
});
grapher.setTraceDuration(morphMs());
applyGrapherTheme();

function wire(id: string, onClick: () => void): void {
  document.getElementById(id)?.addEventListener("click", onClick);
}
wire("view-graph", () => {
  pausePlay();
  grapher.setViewMode("graph");
});
wire("view-block", () => {
  pausePlay();
  grapher.setViewMode("block");
});
wire("zoom-in", () => grapher.zoomBy(1.25));
wire("zoom-out", () => grapher.zoomBy(0.8));
wire("fit", () => grapher.fitView());
wire("pan-up", () => grapher.panBy(0, 60));
wire("pan-left", () => grapher.panBy(60, 0));
wire("pan-right", () => grapher.panBy(-60, 0));
wire("pan-down", () => grapher.panBy(0, -60));

// Fill the view once the container has a size (an off-screen mount measures zero for a frame or two),
// then keep it fitted as the panel resizes.
function fitWhenReady(tries = 30): void {
  if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
    grapher.tidy();
    refreshSource();
  } else if (tries > 0) {
    requestAnimationFrame(() => fitWhenReady(tries - 1));
  }
}
requestAnimationFrame(() => fitWhenReady());
new ResizeObserver(() => grapher.fitView()).observe(canvas);

refreshUi();
