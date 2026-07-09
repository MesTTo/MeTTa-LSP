// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The block, width-driven MeTTa layout: short forms stay on one line, overflowing forms break with each
// argument on its own line at a fixed indent, def-like heads keep their subject on the head line.

import { describe, expect, it } from "vitest";
import { formatMetta } from "../formatMetta.js";

const fmt = (src: string, width = 80): string => formatMetta(src, { width }).trimEnd();

describe("formatMetta layout", () => {
  it("keeps a short form on one line and normalizes inner spacing", () => {
    expect(fmt("(:   greet    (-> String String))")).toBe("(: greet (-> String String))");
  });

  it("aligns a def body under the pattern", () => {
    const src = "(= (factorial $n) (if (== $n 0) 1 (* $n (factorial (- $n 1)))))";
    expect(fmt(src, 50)).toBe(
      "(= (factorial $n)\n   (if (== $n 0) 1 (* $n (factorial (- $n 1)))))",
    );
  });

  it("aligns if branches under the condition (symmetric form)", () => {
    const src = "(= (fib $N) (if (< $N 2) $N (+ (fib (- $N 1)) (fib (- $N 2)))))";
    expect(fmt(src, 40)).toBe(
      [
        "(= (fib $N)",
        "   (if (< $N 2)",
        "       $N",
        "       (+ (fib (- $N 1)) (fib (- $N 2)))))",
      ].join("\n"),
    );
  });

  it("fills a run of simple atoms into a width-sized grid", () => {
    // the user's example: pack atoms across, wrap by width, wrapped rows aligned under the first
    expect(fmt("(A B C D E F G H)", 6)).toBe("(A B C\n D E F\n G H)");
  });

  it("fills an overflowing all-atom call into a grid rather than one per line", () => {
    const src = "(process aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd)";
    expect(fmt(src, 30)).toBe("(process aaaaaaaaaa bbbbbbbbbb\n cccccccccc dddddddddd)");
  });

  it("preserves the author's rows for 2-D data like a board", () => {
    // a tuple of tuples laid out as rows: keep the rows (the shape is the meaning), only fix spacing
    const messy =
      "((1 3 g r)   (2 3 g n) (3 3 g b)\n  (1 2 g p) (2 2 g p) (3 2 g p)\n (1 1 s r) (2 1 s n) (3 1 s b))";
    expect(fmt(messy, 80)).toBe(
      [
        "((1 3 g r) (2 3 g n) (3 3 g b)",
        " (1 2 g p) (2 2 g p) (3 2 g p)",
        " (1 1 s r) (2 1 s n) (3 1 s b))",
      ].join("\n"),
    );
  });

  it("formats the reference minimal-MeTTa switch definition idiomatically", () => {
    const src =
      "(= (switch $atom $cases) (function (chain (decons-atom $cases) $list (chain (eval (switch-internal $atom $list)) $res (unify $res NotReducible (return Empty) (return $res))))))";
    expect(fmt(src, 80)).toBe(
      [
        "(= (switch $atom $cases)",
        "   (function",
        "     (chain (decons-atom $cases) $list",
        "       (chain (eval (switch-internal $atom $list)) $res",
        "         (unify $res NotReducible (return Empty) (return $res))))))",
      ].join("\n"),
    );
  });

  it("collapses multiple blank lines between top-level forms to one", () => {
    expect(fmt("(: a Type)\n\n\n(: b Type)")).toBe("(: a Type)\n\n(: b Type)");
  });

  it("keeps a leading comment on its own line above the form", () => {
    expect(fmt("; header\n(: a Type)")).toBe("; header\n(: a Type)");
  });

  it("keeps a trailing comment after a form that still fits on one line", () => {
    expect(fmt("(: a Type)   ; a note")).toBe("(: a Type) ; a note");
  });

  it("keeps a trailing comment attached and wraps the grid after it", () => {
    // an all-atom list is a filled grid; a comment on an item forces the next item to wrap
    expect(fmt("(foo x ; note\n  y)")).toBe("(foo x ; note\n y)");
  });

  it("preserves a comment between two forms without inventing a blank line", () => {
    expect(fmt("(: a Type)\n; between\n(: b Type)")).toBe("(: a Type)\n; between\n(: b Type)");
  });

  it("keeps a trailing comment at the end of the document", () => {
    expect(fmt("(: a Type)\n; the end")).toBe("(: a Type)\n; the end");
  });

  it("keeps an arg's leading comment on its own line and stays idempotent", () => {
    // a leading comment before the first -> argument must stay on its own line; hoisting the arg would drag
    // the comment onto the head line, where reformatting re-reads it as the head's trailing comment
    const src = "(: BCI (->\n;; Premises\n$x\n$y))";
    const once = fmt(src);
    expect(once).not.toContain("(-> ;; Premises");
    expect(once).toContain(";; Premises");
    expect(fmt(once)).toBe(once);
  });

  it("treats a config-declared align form like a built-in symmetric form", () => {
    // `my-op` is unknown by default (would block head-alone); config makes it align under the first arg
    const src = "(my-op aaaaaaaaaa bbbbbbbbbb cccccccccc)";
    const aligned = formatMetta(src, { width: 20, alignForms: ["my-op"] }).trimEnd();
    expect(aligned).toBe("(my-op aaaaaaaaaa\n       bbbbbbbbbb\n       cccccccccc)");
  });

  it("treats a config-declared block form as keeping N setup args on the head line", () => {
    const src = "(with-scope $env aaaaaaaaaa bbbbbbbbbb cccccccccc)";
    const blocked = formatMetta(src, { width: 24, headLineArgs: { "with-scope": 1 } }).trimEnd();
    expect(blocked).toBe(
      ["(with-scope $env", "  aaaaaaaaaa", "  bbbbbbbbbb", "  cccccccccc)"].join("\n"),
    );
  });

  it("aligns the def body, then blocks the general forms below it", () => {
    const src =
      '(= (skill-list $skills) (div (@ (style style-container)) (input (@ (style (merge ui/input (background-color (hsl 200 80 80)))) (value $state) (placeholder "empty")))))';
    expect(fmt(src, 80)).toBe(
      [
        "(= (skill-list $skills)",
        "   (div",
        "     (@ (style style-container))",
        "     (input",
        "       (@",
        "         (style (merge ui/input (background-color (hsl 200 80 80))))",
        "         (value $state)",
        '         (placeholder "empty")))))',
      ].join("\n"),
    );
  });
});
