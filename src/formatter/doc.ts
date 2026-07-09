// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A Wadler-Leijen pretty-printing document algebra, the engine behind width-driven reflow (the model Prettier
// and Clojure's zprint use). You build a `Doc` describing the STRUCTURE of the output, then `render` decides
// the line breaks: a `group` is printed flat on one line when it fits the target width, and broken across
// lines when it does not. `nest` sets the indentation that broken lines inside it use. This is what turns a
// MeTTa form into "inline when short, expanded and indented when long".

export type Doc =
  | { readonly kind: "text"; readonly text: string }
  // A break point. `flat` is what it renders as on a single line (a space, or nothing for a soft break);
  // when its enclosing group breaks it renders as a newline plus the current indent. `hard` forces the
  // enclosing group to break.
  | { readonly kind: "line"; readonly flat: string; readonly hard: boolean }
  | { readonly kind: "concat"; readonly parts: readonly Doc[] }
  | { readonly kind: "nest"; readonly indent: number; readonly doc: Doc }
  | { readonly kind: "group"; readonly doc: Doc }
  // Renders as nothing, but forces every enclosing group to break. A trailing line comment uses this: the
  // form must open (the comment would otherwise swallow the rest of the line) without an extra newline.
  | { readonly kind: "break-parent" }
  // Pack `items` onto lines separated by `sep`, wrapping to a new line only when the next item does not fit
  // the width. This is the grid layout for a run of small atoms: `(A B C  D E F  G H)` rather than one per
  // line. Each break decision is independent, looking one item ahead.
  | { readonly kind: "fill"; readonly items: readonly Doc[]; readonly sep: Doc };

export function text(value: string): Doc {
  return { kind: "text", text: value };
}

// A space on one line, a newline when broken.
export const line: Doc = { kind: "line", flat: " ", hard: false };
// Nothing on one line, a newline when broken (for gluing to an open paren).
export const softline: Doc = { kind: "line", flat: "", hard: false };
// Always a newline, and forces the enclosing group to break.
export const hardline: Doc = { kind: "line", flat: "\n", hard: true };

export function concat(parts: readonly Doc[]): Doc {
  return { kind: "concat", parts };
}

export function nest(indent: number, doc: Doc): Doc {
  return { kind: "nest", indent, doc };
}

export function group(doc: Doc): Doc {
  return { kind: "group", doc };
}

export const breakParent: Doc = { kind: "break-parent" };

export function fill(items: readonly Doc[], separator: Doc = line): Doc {
  return { kind: "fill", items, sep: separator };
}

// Join docs with a separator between each.
export function join(separator: Doc, docs: readonly Doc[]): Doc {
  const parts: Doc[] = [];
  docs.forEach((doc, index) => {
    if (index > 0) parts.push(separator);
    parts.push(doc);
  });
  return concat(parts);
}

type Mode = "flat" | "break";
interface Cmd {
  readonly indent: number;
  readonly mode: Mode;
  readonly doc: Doc;
}

function containsHardline(doc: Doc): boolean {
  switch (doc.kind) {
    case "text":
      return false;
    case "line":
      return doc.hard;
    case "concat":
      return doc.parts.some(containsHardline);
    case "nest":
    case "group":
      return containsHardline(doc.doc);
    case "break-parent":
      return true;
    case "fill":
      return doc.items.some(containsHardline) || containsHardline(doc.sep);
  }
}

// Does this group, rendered flat, fit in `remaining` columns? Scans the group's own flat width; a group's own
// closing text is part of its doc, so trailing outer content is left for the enclosing group to weigh.
function fitsFlat(remaining: number, doc: Doc): boolean {
  let width = remaining;
  const stack: Doc[] = [doc];
  while (width >= 0 && stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    switch (current.kind) {
      case "text":
        width -= current.text.length;
        break;
      case "line":
        // groups reaching here are already known hardline-free, so every line is its flat form
        width -= current.flat.length;
        break;
      case "concat":
        // width is order-independent, so push in any order
        for (const part of current.parts) stack.push(part);
        break;
      case "nest":
      case "group":
        stack.push(current.doc);
        break;
      case "break-parent":
        break;
      case "fill":
        for (const item of current.items) stack.push(item);
        for (let i = 1; i < current.items.length; i++) stack.push(current.sep);
        break;
    }
  }
  return width >= 0;
}

export function render(doc: Doc, width = 80): string {
  const out: string[] = [];
  let column = 0;
  const stack: Cmd[] = [{ indent: 0, mode: "break", doc }];
  while (stack.length > 0) {
    const cmd = stack.pop();
    if (cmd === undefined) break;
    const { indent, mode, doc: current } = cmd;
    switch (current.kind) {
      case "text":
        out.push(current.text);
        column += current.text.length;
        break;
      case "concat":
        for (const part of [...current.parts].reverse()) stack.push({ indent, mode, doc: part });
        break;
      case "nest":
        stack.push({ indent: indent + current.indent, mode, doc: current.doc });
        break;
      case "line":
        if (mode === "flat" && !current.hard) {
          out.push(current.flat);
          column += current.flat.length;
        } else {
          out.push(`\n${" ".repeat(indent)}`);
          column = indent;
        }
        break;
      case "group": {
        const flat = !containsHardline(current.doc) && fitsFlat(width - column, current.doc);
        stack.push({ indent, mode: flat ? "flat" : "break", doc: current.doc });
        break;
      }
      case "break-parent":
        break;
      case "fill": {
        const { items, sep } = current;
        const [first, ...rest] = items;
        if (first === undefined) break;
        const firstFlat = fitsFlat(width - column, first);
        const next = rest[0];
        if (next === undefined) {
          stack.push({ indent, mode: firstFlat ? "flat" : "break", doc: first });
          break;
        }
        // keep the separator flat only if this item and the next both fit the current line, and this item
        // does not carry a forced break (a trailing line comment must push the next item to a new line)
        const pairFlat =
          !containsHardline(first) && fitsFlat(width - column, concat([first, sep, next]));
        stack.push({ indent, mode: "break", doc: { kind: "fill", items: rest, sep } });
        stack.push({ indent, mode: pairFlat ? "flat" : "break", doc: sep });
        stack.push({ indent, mode: firstFlat ? "flat" : "break", doc: first });
        break;
      }
    }
  }
  return out.join("");
}
