// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The shared front half of trace, visualise, and the DAP debugger: load the optional visualise stack
// (@metta-ts/hyperon + @metta-ts/grapher), seed a runner with the program, and parse the query atom.
// The packages import lazily so the default LSP paths never pay for them; `feature` names the command
// in the error when they are absent.

import type { Atom, MeTTa } from "@metta-ts/hyperon";

export interface GrapherSession {
  readonly grapher: typeof import("@metta-ts/grapher");
  readonly runner: MeTTa;
  readonly atom: Atom;
}

export async function openGrapherSession(
  feature: string,
  source: string,
  query: string,
  imports: Readonly<Record<string, string>> = {},
): Promise<GrapherSession> {
  let hyperon: typeof import("@metta-ts/hyperon");
  let grapher: typeof import("@metta-ts/grapher");
  try {
    [hyperon, grapher] = await Promise.all([
      import("@metta-ts/hyperon"),
      import("@metta-ts/grapher"),
    ]);
  } catch {
    throw new Error(
      `metta ${feature} requires the optional @metta-ts/hyperon and @metta-ts/grapher packages.`,
    );
  }
  const runner = new hyperon.MeTTa();
  // Load the file's resolved imports before the program (deduped by source, since importSourceMap keys a
  // module under several names) so a cross-file query reduces against them. The hyperon runner does no file
  // resolution of its own, and the program's own (import! …) is inert here.
  for (const moduleSource of new Set(Object.values(imports))) runner.run(moduleSource);
  runner.run(source);
  const atom = runner.parseSingle(query);
  if (atom === undefined) throw new Error(`could not parse query: ${query}`);
  return { grapher, runner, atom };
}
