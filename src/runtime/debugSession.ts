// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A step-through reduction session for the debugger. It advances a query one rewrite at a time with
// `@metta-ts/grapher`'s `reduceStep` (lazy, so a non-terminating reduction can still be paused), reporting
// the current expression at each step and pausing when a `(breakpoint! ...)` atom appears. The stepping is
// injected, so the session is unit-testable; the factory wires the optional runtime packages.

import type { Atom, MeTTa } from "@metta-ts/hyperon";
import { openGrapherSession } from "./grapherSession.js";

type LazyCache = Map<string, Set<number>>;
type ReduceStep = (atom: Atom, metta: MeTTa, cache: LazyCache) => Atom[] | null;
type TextOf = (atom: Atom) => string;

export interface StepState {
  readonly expression: string;
  readonly step: number;
  readonly done: boolean;
  readonly atBreakpoint: boolean;
}

export class ReductionSession {
  private current: Atom;
  private done = false;
  private steps = 0;
  private readonly cache: LazyCache = new Map();

  public constructor(
    private readonly metta: MeTTa,
    atom: Atom,
    private readonly reduceStep: ReduceStep,
    private readonly textOf: TextOf,
  ) {
    this.current = atom;
  }

  // Advance one rewrite. At the normal form the session is done and stepping is a no-op.
  public step(): StepState {
    if (!this.done) {
      const next = this.reduceStep(this.current, this.metta, this.cache);
      if (next === null || next.length === 0) {
        this.done = true;
      } else {
        this.current = next[0] as Atom;
        this.steps += 1;
      }
    }
    return this.state();
  }

  // Run until a `(breakpoint! ...)` atom appears in the current expression or the reduction finishes. The
  // step cap guards against a non-terminating reduction.
  public continue(maxSteps = 100000): StepState {
    for (let guard = 0; !this.done && guard < maxSteps; guard += 1) {
      const state = this.step();
      if (state.atBreakpoint) break;
    }
    return this.state();
  }

  public state(): StepState {
    const expression = this.textOf(this.current);
    return {
      expression,
      step: this.steps,
      done: this.done,
      atBreakpoint: expression.includes("breakpoint!"),
    };
  }
}

export async function createReductionSession(
  source: string,
  query: string,
  imports: Readonly<Record<string, string>> = {},
): Promise<ReductionSession> {
  const { grapher, runner, atom } = await openGrapherSession("debug", source, query, imports);
  return new ReductionSession(runner, atom, grapher.reduceStep, grapher.textOf);
}
