// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: Apache-2.0

// A small MeTTa syntax highlighter for the live sandbox. The token categories mirror the shipped
// TextMate grammar: comments, strings, numbers, @doc atoms, $variables, &space refs, capitalized type
// atoms, %Special% meta-types, the core operators, and parens. Static Markdown fences use the same
// grammar through Shiki.
const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TOKEN =
  /(?<comment>;[^\n]*)|(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(?<variable>\$[A-Za-z_][A-Za-z0-9_\-?!*/<>=.]*)|(?<space>&[A-Za-z_][A-Za-z0-9_\-?!*/<>=.]*)|(?<doc>@[A-Za-z_][A-Za-z0-9_\-*]*!?)|(?<type>(?<![^\s()[\]{}])(?:%[A-Za-z][A-Za-z0-9]*%|[A-Z][A-Za-z0-9_\-?!*/<>=.]*)(?![^\s()[\]{}]))|(?<operator>(?<![^\s()[\]{}])(?:->|==|~=)(?![^\s()[\]{}]))|(?<number>(?<![^\s()[\]{}])[+-]?(?:(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)(?![^\s()[\]{}]))|(?<control>(?<![^\s()[\]{}])[:=!](?![^\s()[\]{}]))|(?<paren>[()[\]{}])/gu;

/** Highlight MeTTa source as HTML, wrapping tokens in `mh-*` spans. */
export function highlightMetta(code: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const t = m[0];
    const groups = m.groups ?? {};
    let cls: string;
    if (groups.comment !== undefined) cls = "mh-comment";
    else if (groups.string !== undefined) cls = "mh-string";
    else if (groups.variable !== undefined) cls = "mh-var";
    else if (groups.space !== undefined) cls = "mh-spaceref";
    else if (groups.doc !== undefined) cls = "mh-at";
    else if (groups.type !== undefined) cls = "mh-type";
    else if (groups.operator !== undefined) cls = t === "->" ? "mh-control" : "mh-operator";
    else if (groups.number !== undefined) cls = "mh-number";
    else if (groups.control !== undefined) cls = "mh-control";
    else cls = "mh-paren";
    out += `<span class="${cls}">${esc(t)}</span>`;
    last = m.index + t.length;
  }
  out += esc(code.slice(last));
  return out;
}
