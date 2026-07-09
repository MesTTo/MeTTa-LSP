// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

const VALUE_FLAGS = new Set([
  "--base",
  "--host-roots",
  "--max",
  "--module-roots",
  "--out",
  "--port",
]);

export function flagValue(args: readonly string[], flag: string): string | undefined {
  const inlinePrefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline !== undefined) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function positionalArgs(args: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}
