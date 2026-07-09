// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Visualise generates SVG reduction frames over the real runtime, and renders them into a self-contained,
// offline HTML page with playback controls.

import { describe, expect, it } from "vitest";
import { framesToHtml, reductionFrames } from "../visualise.js";

describe("reductionFrames", () => {
  it("generates SVG frames for a query's reduction", async () => {
    const result = await reductionFrames("(= (double $x) (* 2 $x))", "(double 21)", { width: 400 });
    expect(result.frames.length).toBeGreaterThan(1);
    expect(result.frames[0]?.svg).toContain("<svg");
    expect(result.width).toBe(400);
  });

  it("generates the nested-block view", async () => {
    const result = await reductionFrames("(= (double $x) (* 2 $x))", "(double 21)", {
      block: true,
    });
    expect(result.frames[0]?.svg).toContain("<svg");
  });

  it("rejects an unparseable query", async () => {
    await expect(reductionFrames("", "")).rejects.toThrow("could not parse");
  });
});

describe("framesToHtml", () => {
  it("embeds the frames in a self-contained page with playback controls", () => {
    const html = framesToHtml(
      { frames: [{ svg: "<svg><rect/></svg>", delay: 100 }], width: 400, height: 200 },
      "(double 21) reduction",
    );
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('id="play"');
    expect(html).toContain("JSON.parse");
    // the embedded SVG has `<` escaped so it can never close the surrounding script tag
    expect(html).toContain("\\u003csvg");
    // fully offline: no external requests
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("escapes the title so it cannot inject markup", () => {
    const html = framesToHtml({ frames: [], width: 1, height: 1 }, "<script>x</script>");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script");
  });
});
