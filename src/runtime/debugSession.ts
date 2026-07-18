// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A step-through reduction session for the debugger. It advances a query one rewrite at a time with
// `@metta-ts/grapher`'s `reduceStep` (lazy, so a non-terminating reduction can still be paused), reporting
// the current expression at each step and pausing when a `(breakpoint! ...)` atom appears. The engine trace
// from @metta-ts/debug is collected once at launch and exposed as debug variables. The stepping is injected,
// so the session is unit-testable; the factory wires the optional runtime packages.

import type { Atom, MeTTa } from "@metta-ts/hyperon";
import { collectMettaEngineTrace, type EngineTraceDetails } from "./debugTrace.js";
import { openGrapherSession } from "./grapherSession.js";

type LazyCache = Map<string, Set<number>>;
type ReduceStep = (atom: Atom, metta: MeTTa, cache: LazyCache) => Atom[] | null;
type TextOf = (atom: Atom) => string;

export interface StepState {
  readonly expression: string;
  readonly step: number;
  readonly done: boolean;
  readonly atBreakpoint: boolean;
  readonly atOverflowCutPoint: boolean;
  readonly overflowCutPoint?: string;
  readonly trace: DebugTraceState;
}

export interface DebugTraceState {
  readonly reductions: number;
  readonly grounded: Readonly<Record<string, number>>;
  readonly specialized: readonly string[];
  readonly overflow: readonly string[];
  readonly eventCount: number;
}

export class ReductionSession {
  private current: Atom;
  private done = false;
  private steps = 0;
  private stoppedAtOverflow = false;
  private readonly cache: LazyCache = new Map();

  public constructor(
    private readonly metta: MeTTa,
    atom: Atom,
    private readonly reduceStep: ReduceStep,
    private readonly textOf: TextOf,
    private readonly engineTrace: EngineTraceDetails,
  ) {
    this.current = atom;
  }

  // Advance one rewrite. At the normal form the session is done and stepping is a no-op.
  public step(): StepState {
    if (!this.done && !this.stoppedAtOverflow) {
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
  // step cap guards against a non-terminating reduction. If the engine trace found a native overflow cut,
  // stop there instead of trying to force the grapher reducer past the same point.
  public continue(maxSteps = 100000): StepState {
    if (this.engineTrace.summary.overflow.length > 0) {
      this.stoppedAtOverflow = true;
      return this.state();
    }
    for (let guard = 0; !this.done && guard < maxSteps; guard += 1) {
      const state = this.step();
      if (state.atBreakpoint) break;
    }
    return this.state();
  }

  public state(): StepState {
    const overflowCutPoint = this.stoppedAtOverflow
      ? this.engineTrace.summary.overflow[0]
      : undefined;
    const expression = overflowCutPoint ?? this.textOf(this.current);
    return {
      expression,
      step: this.steps,
      done: this.done,
      atBreakpoint: expression.includes("breakpoint!"),
      atOverflowCutPoint: overflowCutPoint !== undefined,
      overflowCutPoint,
      trace: {
        reductions: this.engineTrace.summary.reductions,
        grounded: this.engineTrace.summary.grounded,
        specialized: this.engineTrace.summary.specialized,
        overflow: this.engineTrace.summary.overflow,
        eventCount: this.engineTrace.trace.length,
      },
    };
  }
}

export async function createReductionSession(
  source: string,
  query: string,
  imports: Readonly<Record<string, string>> = {},
): Promise<ReductionSession> {
  const [{ grapher, runner, atom }, engineTrace] = await Promise.all([
    openGrapherSession("debug", source, query, imports),
    collectMettaEngineTrace(source, query, imports),
  ]);
  return new ReductionSession(runner, atom, grapher.reduceStep, grapher.textOf, engineTrace);
}
