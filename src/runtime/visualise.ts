// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Visualise a query's reduction as a sequence of SVG frames, using `@metta-ts/grapher`'s pure (no-DOM)
// `graphReductionSvgs` / `blockReductionSvgs` over the `@metta-ts/hyperon` runner. The frames render offline,
// so a CLI writes them into a self-contained HTML page and a VS Code webview shows the same page. The page
// builder is pure and unit-testable; only the frame generation needs the optional packages.

import { openGrapherSession } from "./grapherSession.js";

export interface ReductionFrame {
  readonly svg: string;
  readonly delay: number;
}

export interface ReductionFrames {
  readonly frames: readonly ReductionFrame[];
  readonly width: number;
  readonly height: number;
}

export interface VisualiseOptions {
  readonly block?: boolean;
  readonly width?: number;
  readonly maxSteps?: number;
  // The file's resolved imports (module name -> source), loaded before the program so a cross-file query
  // reduces against them.
  readonly imports?: Readonly<Record<string, string>>;
}

// Generate the reduction of a query as SVG frames — the node-graph view, or the nested-block view with
// `block`. Requires the optional `@metta-ts/hyperon` and `@metta-ts/grapher` packages.
export async function reductionFrames(
  source: string,
  query: string,
  options: VisualiseOptions = {},
): Promise<ReductionFrames> {
  const { grapher, runner, atom } = await openGrapherSession(
    "visualise",
    source,
    query,
    options.imports ?? {},
  );
  const states = grapher.reduceTrace(atom, runner, options.maxSteps ?? 100);
  const width = options.width ?? 720;
  const out =
    options.block === true
      ? grapher.blockReductionSvgs(states, { width })
      : grapher.graphReductionSvgs(states, { width });
  return { frames: out.frames, width: out.width, height: out.height };
}

// Escape `<` so an embedded SVG can never close the surrounding <script> tag.
function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

// A self-contained HTML page that steps and plays through the reduction frames. The SVG strings are embedded,
// so it renders with no external requests, in a VS Code webview or any browser.
export function framesToHtml(result: ReductionFrames, title: string): string {
  const data = safeJson(result.frames);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title.replaceAll("<", "&lt;")}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; }
  #bar { display: flex; gap: .5rem; align-items: center; padding: .5rem; border-bottom: 1px solid #8884; }
  #stage { display: grid; place-items: center; padding: 1rem; overflow: auto; }
  button { font: inherit; cursor: pointer; }
  #count { margin-left: auto; opacity: .7; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div id="bar">
  <button id="prev" title="Previous step">&#9198;</button>
  <button id="play" title="Play/pause">&#9654;</button>
  <button id="next" title="Next step">&#9197;</button>
  <span id="count"></span>
</div>
<div id="stage"></div>
<script type="application/json" id="frames">${data}</script>
<script>
  const frames = JSON.parse(document.getElementById("frames").textContent);
  const stage = document.getElementById("stage");
  const count = document.getElementById("count");
  let i = 0, timer = null;
  function draw() {
    stage.innerHTML = frames.length ? frames[i].svg : "no reduction";
    count.textContent = frames.length ? (i + 1) + " / " + frames.length : "";
  }
  function step(d) { if (frames.length) { i = (i + d + frames.length) % frames.length; draw(); } }
  function stop() { if (timer) { clearInterval(timer); timer = null; document.getElementById("play").textContent = "\\u25B6"; } }
  function play() {
    if (timer) { stop(); return; }
    document.getElementById("play").textContent = "\\u23F8";
    timer = setInterval(() => { i = (i + 1) % frames.length; draw(); if (i === 0) stop(); }, 500);
  }
  document.getElementById("prev").onclick = () => { stop(); step(-1); };
  document.getElementById("next").onclick = () => { stop(); step(1); };
  document.getElementById("play").onclick = play;
  draw();
</script>
</body>
</html>`;
}
