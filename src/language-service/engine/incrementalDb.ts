// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A version-keyed red-green incremental memo database, the pyright/tsserver + rust-analyzer/Salsa pattern
// hand-rolled in plain TypeScript with zero runtime dependencies (§3 of the design).
//
// Inputs are named cells; setting one to a genuinely new value bumps a global revision (a no-op write does
// not, the tsserver version-compare). Queries are pure functions of inputs and other queries; each read is
// recorded as a dependency edge automatically, so the parse -> index -> diagnostics DAG is implicit.
//
// Each memo stores `verifiedAt` (the last revision it was confirmed current) and `changedAt` (the last
// revision its value actually changed). Bringing a query up to date is:
//   - fast path: verifiedAt === revision -> already current.
//   - GREEN: no dependency's value changed since verifiedAt -> bump verifiedAt, do not recompute.
//   - RED: some dependency changed -> recompute; and if the new value equals the old one (`eq`), changedAt
//     is NOT bumped, so a formatting-only edit that reparses to the same index does not re-run diagnostics
//     (early cutoff).
//
// The firewall that makes this correct: a query is recomputed only when a dependency's VALUE changed, not
// merely when the revision moved. To check a query dependency we first bring it up to date (via a stored
// recompute thunk that captures the query and its argument) and then compare its changedAt to the point we
// last verified the dependent.

export type Revision = number & { readonly __rev: unique symbol };

const INITIAL_REVISION = 1 as Revision;

export interface QueryContext {
  // Read an input cell, recording a dependency on it. The store is heterogeneous, so the value is
  // `unknown`; callers assert the concrete type (typically through a typed accessor).
  input(key: string): unknown;
  // Read another query, recording a dependency on it.
  query<A, V>(query: Query<A, V>, arg: A): V;
}

export interface Query<A, V> {
  readonly id: string;
  key(arg: A): string;
  run(ctx: QueryContext, arg: A): V;
  // Value equality for early cutoff (default Object.is). Return true when a recompute produced an
  // equivalent value so dependents are not re-run.
  eq?(a: V, b: V): boolean;
}

type Dependency =
  | { readonly kind: "input"; readonly key: string }
  | { readonly kind: "query"; readonly memoKey: string };

interface Memo {
  value: unknown;
  verifiedAt: Revision;
  changedAt: Revision;
  dependencies: readonly Dependency[];
  recompute: () => void;
}

export class IncrementalDb {
  private revision = INITIAL_REVISION;
  private readonly inputs = new Map<string, { value: unknown; changedAt: Revision }>();
  private readonly memos = new Map<string, Memo>();
  // Memo keys whose `run` is currently on the stack. Queries here are meant to form a DAG (the closure BFS
  // is flattened into a single query, not recursive), so a re-entry means an accidental dependency cycle;
  // we throw a clear error rather than recurse until the stack overflows (Salsa handles cycles with
  // provisional memos + fixpoint iteration, which this engine deliberately does not need).
  private readonly computing = new Set<string>();

  public getRevision(): Revision {
    return this.revision;
  }

  // Set an input. A write that does not change the value leaves the revision untouched, so a no-op edit
  // costs nothing downstream.
  public setInput(key: string, value: unknown): void {
    const existing = this.inputs.get(key);
    if (existing && Object.is(existing.value, value)) return;
    this.revision = (this.revision + 1) as Revision;
    this.inputs.set(key, { value, changedAt: this.revision });
  }

  public hasInput(key: string): boolean {
    return this.inputs.has(key);
  }

  // The number of live memos (a status/diagnostic aid, e.g. for the index-stats report).
  public memoCount(): number {
    return this.memos.size;
  }

  public query<A, V>(query: Query<A, V>, arg: A): V {
    const memoKey = `${query.id} ${query.key(arg)}`;
    this.bringUpToDate(memoKey, () => {
      this.recompute(query, arg, memoKey);
    });
    return this.memos.get(memoKey)?.value as V;
  }

  private readInput(key: string): unknown {
    const cell = this.inputs.get(key);
    if (!cell) throw new Error(`incremental-db: read of unset input "${key}"`);
    return cell.value;
  }

  private bringUpToDate(memoKey: string, recompute: () => void): void {
    const memo = this.memos.get(memoKey);
    if (memo && memo.verifiedAt === this.revision) return;
    if (memo && !this.anyDependencyChangedSince(memo.dependencies, memo.verifiedAt)) {
      memo.verifiedAt = this.revision;
      return;
    }
    recompute();
  }

  private recompute<A, V>(query: Query<A, V>, arg: A, memoKey: string): void {
    if (this.computing.has(memoKey)) {
      throw new Error(`incremental-db: dependency cycle detected at query "${memoKey}"`);
    }
    const previous = this.memos.get(memoKey);
    const dependencies: Dependency[] = [];
    this.computing.add(memoKey);
    try {
      const value = query.run(this.contextRecording(dependencies), arg);
      const recompute = (): void => {
        this.recompute(query, arg, memoKey);
      };
      if (previous !== undefined) {
        const unchanged =
          query.eq !== undefined
            ? query.eq(value, previous.value as V)
            : Object.is(value, previous.value);
        if (unchanged) {
          previous.dependencies = dependencies;
          previous.verifiedAt = this.revision;
          previous.recompute = recompute;
          return;
        }
      }
      this.memos.set(memoKey, {
        value,
        verifiedAt: this.revision,
        changedAt: this.revision,
        dependencies,
        recompute,
      });
    } finally {
      this.computing.delete(memoKey);
    }
  }

  private contextRecording(dependencies: Dependency[]): QueryContext {
    return {
      input: (key: string): unknown => {
        dependencies.push({ kind: "input", key });
        return this.readInput(key);
      },
      query: <A, V>(query: Query<A, V>, arg: A): V => {
        const memoKey = `${query.id} ${query.key(arg)}`;
        dependencies.push({ kind: "query", memoKey });
        this.bringUpToDate(memoKey, () => {
          this.recompute(query, arg, memoKey);
        });
        return this.memos.get(memoKey)?.value as V;
      },
    };
  }

  // Has any dependency's value changed since `since`? Query dependencies are brought up to date first so
  // their changedAt is authoritative (the red-green firewall).
  private anyDependencyChangedSince(dependencies: readonly Dependency[], since: Revision): boolean {
    for (const dependency of dependencies) {
      if (dependency.kind === "input") {
        const cell = this.inputs.get(dependency.key);
        if (!cell || cell.changedAt > since) return true;
        continue;
      }
      const memo = this.memos.get(dependency.memoKey);
      if (!memo) return true;
      if (memo.verifiedAt !== this.revision) {
        if (this.anyDependencyChangedSince(memo.dependencies, memo.verifiedAt)) memo.recompute();
        else memo.verifiedAt = this.revision;
      }
      const current = this.memos.get(dependency.memoKey);
      if (!current || current.changedAt > since) return true;
    }
    return false;
  }
}
