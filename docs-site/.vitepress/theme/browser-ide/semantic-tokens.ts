// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type { LSPClient, LSPClientExtension } from "@codemirror/lsp-client";
import { RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

interface SemanticTokensResult {
  readonly data: readonly number[];
}

interface SemanticTokensProvider {
  readonly legend?: {
    readonly tokenTypes?: readonly string[];
    readonly tokenModifiers?: readonly string[];
  };
}

const TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
  "mettaControlFlow",
  "mettaBinding",
  "mettaPattern",
  "mettaModule",
  "mettaTypeOperator",
  "mettaEvaluation",
  "mettaQuote",
  "mettaEffect",
  "mettaArithmeticOperator",
  "mettaComparisonOperator",
  "mettaLogicalOperator",
  "mettaMathFunction",
  "mettaCollectionFunction",
  "mettaPredicateFunction",
  "mettaAssertion",
];

export const semanticTokensClientExtension: LSPClientExtension = {
  clientCapabilities: {
    textDocument: {
      semanticTokens: {
        dynamicRegistration: false,
        formats: ["relative"],
        multilineTokenSupport: false,
        overlappingTokenSupport: false,
        requests: { full: true },
        tokenModifiers: [],
        tokenTypes: TOKEN_TYPES,
      },
    },
  },
};

const replaceSemanticTokens = StateEffect.define<DecorationSet>();

export const semanticTokenDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(replaceSemanticTokens)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function safeClassPart(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/gu, "-");
}

function semanticDecorations(
  doc: Text,
  data: readonly number[],
  tokenTypes: readonly string[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let line = 0;
  let character = 0;
  for (let index = 0; index + 4 < data.length; index += 5) {
    const lineDelta = data[index] ?? 0;
    const characterDelta = data[index + 1] ?? 0;
    const length = data[index + 2] ?? 0;
    const tokenType = data[index + 3] ?? -1;
    line += lineDelta;
    character = lineDelta === 0 ? character + characterDelta : characterDelta;
    if (line < 0 || line >= doc.lines || length <= 0) continue;
    const documentLine = doc.line(line + 1);
    const from = documentLine.from + character;
    const to = Math.min(documentLine.to, from + length);
    if (from < documentLine.from || from >= documentLine.to || to <= from) continue;
    const typeName = tokenTypes[tokenType] ?? "unknown";
    builder.add(
      from,
      to,
      Decoration.mark({ class: `cm-metta-semantic-${safeClassPart(typeName)}` }),
    );
  }
  return builder.finish();
}

export class SemanticTokenController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  public schedule(client: LSPClient, view: EditorView, uri: string, delay = 140): void {
    this.generation += 1;
    const generation = this.generation;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh(client, view, uri, generation);
    }, delay);
  }

  public clear(view?: EditorView): void {
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (view?.dom.isConnected) {
      view.dispatch({ effects: replaceSemanticTokens.of(Decoration.none) });
    }
  }

  public dispose(): void {
    this.generation += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async refresh(
    client: LSPClient,
    view: EditorView,
    uri: string,
    generation: number,
  ): Promise<void> {
    try {
      await client.initializing;
      if (generation !== this.generation || !view.dom.isConnected) return;
      const provider = client.serverCapabilities?.semanticTokensProvider as
        | SemanticTokensProvider
        | undefined;
      const tokenTypes = provider?.legend?.tokenTypes;
      if (tokenTypes === undefined) return;
      client.sync();
      const document = view.state.doc;
      const result = await client.request<
        { readonly textDocument: { readonly uri: string } },
        SemanticTokensResult | null
      >("textDocument/semanticTokens/full", { textDocument: { uri } });
      if (
        generation !== this.generation ||
        !view.dom.isConnected ||
        view.state.doc !== document
      ) {
        return;
      }
      view.dispatch({
        effects: replaceSemanticTokens.of(
          result === null ? Decoration.none : semanticDecorations(document, result.data, tokenTypes),
        ),
      });
    } catch {
      // Syntax highlighting remains available when semantic tokens are unsupported or a request races a restart.
    }
  }
}
