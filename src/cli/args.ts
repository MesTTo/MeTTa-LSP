// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

const VALUE_FLAGS = new Set([
  "--base",
  "--fuel",
  "--host-roots",
  "--ignore",
  "--max",
  "--max-file-bytes",
  "--max-files",
  "--max-iterations",
  "--max-nodes",
  "--min-atoms",
  "--min-lines",
  "--module-roots",
  "--out",
  "--port",
  "--threshold",
]);

export function flagValue(args: readonly string[], flag: string): string | undefined {
  const inlinePrefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline !== undefined) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function flagValues(args: readonly string[], flag: string): string[] {
  const inlinePrefix = `${flag}=`;
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === flag) {
      const value = args[index + 1];
      if (value !== undefined && !value.startsWith("--")) values.push(value);
      index += 1;
    } else if (arg !== undefined && arg.startsWith(inlinePrefix))
      values.push(arg.slice(inlinePrefix.length));
  }
  return values;
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
