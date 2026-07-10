// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

interface MeTTaStreamState {
  depth: number;
}

const CONTROL_FORMS = new Set([
  "case",
  "collapse",
  "if",
  "import!",
  "let",
  "let*",
  "match",
  "once",
  "quote",
  "superpose",
  "unify",
  "unique-atom",
]);

const parser: StreamParser<MeTTaStreamState> = {
  name: "metta",
  startState: () => ({ depth: 0 }),
  copyState: (state) => ({ ...state }),
  indent: (state, textAfter, context) =>
    Math.max(0, state.depth - (textAfter.trimStart().startsWith(")") ? 1 : 0)) * context.unit,
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.peek() === ";") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const character = stream.next();
        if (!escaped && character === '"') break;
        escaped = !escaped && character === "\\";
        if (character !== "\\") escaped = false;
      }
      return "string";
    }
    if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_!?+*/<>=-]*/u)) return "variableName.special";
    if (stream.match(/^&[A-Za-z_][A-Za-z0-9_.!?+*/<>=-]*/u)) return "namespace";
    if (stream.match(/^-?(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?\b/u)) return "number";
    if (stream.match(/^[()]/u)) {
      state.depth = Math.max(0, state.depth + (stream.current() === "(" ? 1 : -1));
      return "bracket";
    }
    if (stream.match(/^(?:->|==|!=|<=|>=|[=:+*/<>-])/u)) return "operator";
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_.!?+*/<>=-]*/u)) {
      const word = stream.current();
      if (CONTROL_FORMS.has(word)) return "keyword";
      if (/^[A-Z]/u.test(word)) return "typeName";
      return "name";
    }
    stream.next();
    return null;
  },
};

export const mettaLanguage = StreamLanguage.define(parser);

const mettaHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--mh-comment)" },
  { tag: tags.string, color: "var(--mh-string)" },
  { tag: tags.number, color: "var(--mh-number)" },
  { tag: [tags.variableName, tags.special(tags.variableName)], color: "var(--mh-var)" },
  { tag: tags.namespace, color: "var(--mh-at)" },
  { tag: tags.typeName, color: "var(--mh-type)" },
  { tag: [tags.keyword, tags.operatorKeyword, tags.operator], color: "var(--mh-op)" },
  { tag: tags.bracket, color: "var(--mh-paren)" },
]);

export const mettaLanguageExtensions: readonly Extension[] = [
  mettaLanguage,
  syntaxHighlighting(mettaHighlightStyle),
];
