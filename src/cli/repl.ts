// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// An interactive MeTTa repl over `@metta-ts/hyperon`'s stateful runner: non-bang atoms extend the knowledge
// base and persist across lines, `!`-queries print their results, and `:` meta-commands inspect types and
// docs. The line dispatch is a pure function so it is unit-testable without a terminal; the readline loop and
// the (optional) hyperon import are the only impure parts.

import * as fs from "node:fs";
import * as readline from "node:readline";
import type { Atom, MeTTa } from "@metta-ts/hyperon";

const HELP = [
  "  <expr>          add a definition, or evaluate a !-query",
  "  :type <expr>    the types the runner infers for a parsed atom",
  "  :doc <symbol>   the atom's documentation (get-doc)",
  "  :reduce <expr>  evaluate an expression (same as prefixing it with !)",
  "  :help           this message",
  "  :quit, :q       leave the repl",
].join("\n");

export interface ReplResult {
  readonly output: string;
  readonly quit: boolean;
}

// Each `!`-query prints its results as a bracketed list; a line with no `!`-query (a definition) is silent.
function formatResults(results: readonly (readonly Atom[])[]): string {
  return results.map((query) => `[${query.map((atom) => atom.toString()).join(", ")}]`).join("\n");
}

function handleMeta(runner: MeTTa, line: string): ReplResult {
  const space = line.indexOf(" ");
  const command = space === -1 ? line : line.slice(0, space);
  const arg = space === -1 ? "" : line.slice(space + 1).trim();
  switch (command) {
    case ":quit":
    case ":q":
      return { output: "", quit: true };
    case ":help":
      return { output: HELP, quit: false };
    case ":type": {
      const atom = runner.parseSingle(arg);
      if (atom === undefined) return { output: "error: expected an expression", quit: false };
      const types = runner.getAtomTypes(atom).map((type) => type.toString());
      return { output: types.length > 0 ? types.join(", ") : "%Undefined%", quit: false };
    }
    case ":doc":
      return { output: formatResults(runner.run(`!(get-doc ${arg})`)), quit: false };
    case ":reduce":
    case ":r":
      return { output: formatResults(runner.run(`!${arg}`)), quit: false };
    default:
      return { output: `unknown command ${command} (:help for commands)`, quit: false };
  }
}

// Dispatch one repl line against the stateful runner and return what to print. Pure with respect to IO.
export function handleReplLine(runner: MeTTa, line: string): ReplResult {
  const trimmed = line.trim();
  if (trimmed.length === 0) return { output: "", quit: false };
  if (trimmed.startsWith(":")) return handleMeta(runner, trimmed);
  try {
    return { output: formatResults(runner.run(trimmed)), quit: false };
  } catch (error) {
    return {
      output: `error: ${error instanceof Error ? error.message : String(error)}`,
      quit: false,
    };
  }
}

// Start the interactive repl, optionally preloading a file's definitions. Requires the optional
// `@metta-ts/hyperon` package; a clear error is printed if it is absent.
export async function startRepl(preloadPath?: string): Promise<void> {
  let MeTTaCtor: typeof import("@metta-ts/hyperon").MeTTa;
  try {
    MeTTaCtor = (await import("@metta-ts/hyperon")).MeTTa;
  } catch {
    console.error("metta repl requires the optional @metta-ts/hyperon package (npm install it).");
    process.exit(1);
  }
  const runner = new MeTTaCtor();
  if (preloadPath !== undefined) runner.run(fs.readFileSync(preloadPath, "utf8"));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "metta> ",
  });
  console.log("MeTTa repl. :help for commands, :quit to exit.");
  rl.prompt();
  rl.on("line", (line) => {
    const { output, quit } = handleReplLine(runner, line);
    if (output.length > 0) console.log(output);
    if (quit) {
      rl.close();
      return;
    }
    rl.prompt();
  });
  await new Promise<void>((resolve) => {
    rl.on("close", resolve);
  });
}
