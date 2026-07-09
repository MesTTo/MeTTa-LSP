// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Trace the step-by-step reduction of a MeTTa query against a program, using `@metta-ts/grapher`'s
// `reduceTrace` over the `@metta-ts/hyperon` runner. Each step is the set of atoms at that reduction state,
// so `(double 21)` traces as `(double 21)` -> `(* 2 21)` -> `42`. The rendering is a pure function so it is
// unit-testable without the runtime; only the runner setup needs the optional packages.

import { openGrapherSession } from "./grapherSession.js";

export interface TraceResult {
  readonly query: string;
  readonly steps: readonly (readonly string[])[];
  readonly final: readonly string[];
  readonly truncated: boolean;
}

// Render reduction states (each a set of atoms) into step-by-step strings. Generic over the atom type so the
// caller supplies the renderer; `truncated` marks a trace that hit the step budget before fully reducing.
export function renderTrace<A>(
  query: string,
  states: readonly (readonly A[])[],
  textOf: (atom: A) => string,
  maxSteps: number,
): TraceResult {
  const steps = states.map((state) => state.map((atom) => textOf(atom)));
  return {
    query,
    steps,
    final: steps.at(-1) ?? [],
    truncated: states.length >= maxSteps,
  };
}

// Trace a query's reduction against a program's definitions. Requires the optional `@metta-ts/hyperon` and
// `@metta-ts/grapher` packages; a rejection with a clear message is thrown when they are absent, or when the
// query does not parse.
export async function traceReduction(
  source: string,
  query: string,
  maxSteps = 100,
  imports: Readonly<Record<string, string>> = {},
): Promise<TraceResult> {
  const { grapher, runner, atom } = await openGrapherSession("trace", source, query, imports);
  const states = grapher.reduceTrace(atom, runner, maxSteps);
  return renderTrace(query, states, grapher.textOf, maxSteps);
}
