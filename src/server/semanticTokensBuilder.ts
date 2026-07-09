// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Neutral (browser-safe) port of vscode-languageserver's SemanticTokensBuilder
// (node_modules/vscode-languageserver/lib/common/semanticTokens.js, MIT, Copyright (c) Microsoft). The pure
// analysis code depends only on vscode-languageserver-types, which does not ship the builder, so the
// out-of-order-safe delta encoder is inlined here. Only push() and build() are needed; the delta/edit
// machinery (resultId, buildEdits) is dropped.

import type { SemanticTokens } from "vscode-languageserver-types";

export class SemanticTokensBuilder {
  private prevLine = 0;
  private prevChar = 0;
  private sortedAndDeltaEncoded = true;
  private readonly data: number[] = [];
  private nonDelta: number[] = [];
  private len = 0;

  push(
    line: number,
    char: number,
    length: number,
    tokenType: number,
    tokenModifiers: number,
  ): void {
    if (
      this.sortedAndDeltaEncoded &&
      (line < this.prevLine || (line === this.prevLine && char < this.prevChar))
    ) {
      // Push calls were ordered and are no longer ordered: fall back to sorting at build time.
      this.sortedAndDeltaEncoded = false;
      this.nonDelta = SemanticTokensBuilder.deltaDecode(this.data);
    }
    let pushLine = line;
    let pushChar = char;
    if (this.sortedAndDeltaEncoded && this.len > 0) {
      pushLine -= this.prevLine;
      if (pushLine === 0) pushChar -= this.prevChar;
    }
    const target = this.sortedAndDeltaEncoded ? this.data : this.nonDelta;
    target[this.len++] = pushLine;
    target[this.len++] = pushChar;
    target[this.len++] = length;
    target[this.len++] = tokenType;
    target[this.len++] = tokenModifiers;
    this.prevLine = line;
    this.prevChar = char;
  }

  build(): SemanticTokens {
    return {
      data: this.sortedAndDeltaEncoded
        ? this.data
        : SemanticTokensBuilder.sortAndDeltaEncode(this.nonDelta),
    };
  }

  private static deltaDecode(data: readonly number[]): number[] {
    const tokenCount = Math.trunc(data.length / 5);
    let prevLine = 0;
    let prevChar = 0;
    const result: number[] = [];
    for (let i = 0; i < tokenCount; i++) {
      const offset = 5 * i;
      let line = data[offset] ?? 0;
      let char = data[offset + 1] ?? 0;
      if (line === 0) {
        line = prevLine;
        char += prevChar;
      } else {
        line += prevLine;
      }
      result[offset] = line;
      result[offset + 1] = char;
      result[offset + 2] = data[offset + 2] ?? 0;
      result[offset + 3] = data[offset + 3] ?? 0;
      result[offset + 4] = data[offset + 4] ?? 0;
      prevLine = line;
      prevChar = char;
    }
    return result;
  }

  private static sortAndDeltaEncode(data: readonly number[]): number[] {
    const tokenCount = Math.trunc(data.length / 5);
    const order: number[] = [];
    for (let i = 0; i < tokenCount; i++) order[i] = i;
    order.sort((a, b) => {
      const aLine = data[5 * a] ?? 0;
      const bLine = data[5 * b] ?? 0;
      if (aLine === bLine) return (data[5 * a + 1] ?? 0) - (data[5 * b + 1] ?? 0);
      return aLine - bLine;
    });
    const result: number[] = [];
    let prevLine = 0;
    let prevChar = 0;
    for (let i = 0; i < tokenCount; i++) {
      const src = 5 * (order[i] ?? 0);
      const line = data[src] ?? 0;
      const char = data[src + 1] ?? 0;
      const pushLine = line - prevLine;
      const pushChar = pushLine === 0 ? char - prevChar : char;
      const dst = 5 * i;
      result[dst] = pushLine;
      result[dst + 1] = pushChar;
      result[dst + 2] = data[src + 2] ?? 0;
      result[dst + 3] = data[src + 3] ?? 0;
      result[dst + 4] = data[src + 4] ?? 0;
      prevLine = line;
      prevChar = char;
    }
    return result;
  }
}
