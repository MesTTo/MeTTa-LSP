// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The Wadler-Leijen document engine: groups print flat when they fit the width and break otherwise, and
// `nest` controls the indent of broken lines. These are the primitives the MeTTa layout is built from.

import { describe, expect, it } from "vitest";
import { concat, group, hardline, line, nest, render, softline, text } from "../doc.js";

describe("doc pretty-printer engine", () => {
  it("renders a flat group on one line when it fits", () => {
    const doc = group(
      concat([text("(f"), nest(2, concat([line, text("a"), line, text("b")])), text(")")]),
    );
    expect(render(doc, 80)).toBe("(f a b)");
  });

  it("breaks a group that does not fit, indenting with nest", () => {
    const doc = group(
      concat([text("(f"), nest(2, concat([line, text("aaaa"), line, text("bbbb")])), text(")")]),
    );
    expect(render(doc, 8)).toBe("(f\n  aaaa\n  bbbb)");
  });

  it("glues a softline without a space when flat", () => {
    const doc = group(concat([text("("), softline, text("x"), text(")")]));
    expect(render(doc, 80)).toBe("(x)");
  });

  it("forces the group open at a hardline", () => {
    const doc = group(concat([text("a"), hardline, text("b")]));
    expect(render(doc, 80)).toBe("a\nb");
  });

  it("breaks the outer group while an inner group still fits", () => {
    const inner = group(concat([text("(g"), nest(2, concat([line, text("y")])), text(")")]));
    const doc = group(concat([text("(f"), nest(2, concat([line, inner])), text(")")]));
    // outer flat "(f (g y))" is 9 columns; at width 8 the outer breaks but the inner "(g y)" still fits
    expect(render(doc, 8)).toBe("(f\n  (g y))");
  });
});
