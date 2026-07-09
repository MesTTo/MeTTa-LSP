// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The runtime-answer cache (§3). Answers derived by actually evaluating the live atomspace (get-type,
// get-doc, a reduction) are NOT pure projections of the source, so they live OUTSIDE the red-green memo DB
// in this separate store, stamped with BOTH epochs. An entry is reusable only while its syntax epoch AND
// its atomspace epoch both still match the current ones: a text edit advances the syntax epoch, a space
// mutation advances the atomspace epoch, and the two move independently, so editing can never invalidate a
// runtime answer through the atomspace dimension and evaluating can never invalidate one through the syntax
// dimension. Only DEFINITIVE answers are stored (never a "runtime not ready yet" placeholder), so a stored
// miss can never mask an answer that would become available once the runtime warms up.
//
// The RuntimeProvider that fills this store with live answers is wired in a later step; this is the epoch
// mechanism it plugs into. One entry is kept per (method, args) and replaced when the epochs advance, so
// memory is bounded by the number of distinct queries rather than by edit history.

export interface Epochs {
  readonly syntaxEpoch: number;
  readonly atomspaceEpoch: number;
}

interface Entry<V> {
  readonly value: V;
  readonly syntaxEpoch: number;
  readonly atomspaceEpoch: number;
}

export class RuntimeCache<V> {
  private readonly entries = new Map<string, Entry<V>>();

  private static keyOf(method: string, args: string): string {
    return `${method} ${args}`;
  }

  // A definitive answer valid at the current epochs, or undefined if there is none (never computed, or the
  // stored one is stale because either epoch has moved on).
  public get(method: string, args: string, epochs: Epochs): V | undefined {
    const entry = this.entries.get(RuntimeCache.keyOf(method, args));
    if (
      entry === undefined ||
      entry.syntaxEpoch !== epochs.syntaxEpoch ||
      entry.atomspaceEpoch !== epochs.atomspaceEpoch
    ) {
      return undefined;
    }
    return entry.value;
  }

  // Store a definitive answer, stamping it with the epochs it was computed against.
  public set(method: string, args: string, epochs: Epochs, value: V): void {
    this.entries.set(RuntimeCache.keyOf(method, args), {
      value,
      syntaxEpoch: epochs.syntaxEpoch,
      atomspaceEpoch: epochs.atomspaceEpoch,
    });
  }

  // Forget everything (e.g. when the runtime is torn down). Never called on an ordinary edit.
  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }
}
