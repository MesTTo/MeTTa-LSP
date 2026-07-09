// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Workspace excludes accept path fragments and standard path wildcards. Bare fragments match a complete
// segment at any depth, so `test` excludes `/ws/test/a.metta` but not `/ws/latest/a.metta`.

import picomatch from "picomatch";

function stripSlashes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "/") start++;
  while (end > start && value[end - 1] === "/") end--;
  return value.slice(start, end);
}

function normalizePathFragment(value: string): string {
  return stripSlashes(value.replaceAll("\\", "/").replaceAll(/\/+/g, "/"));
}

export function workspaceExcludeGlobs(exclude: readonly string[]): string[] {
  const globs = new Set<string>();
  for (const rawPattern of exclude) {
    const pattern = normalizePathFragment(rawPattern);
    if (pattern.length === 0) continue;
    const glob = pattern.startsWith("**/") ? pattern : `**/${pattern}`;
    globs.add(glob);
    if (glob.endsWith("/**")) globs.add(glob.slice(0, -3));
    else globs.add(`${glob}/**`);
  }
  return [...globs];
}

export function createWorkspaceExcludeMatcher(
  exclude: readonly string[],
  options: { readonly caseSensitive?: boolean } = {},
): (candidate: string) => boolean {
  const globs = workspaceExcludeGlobs(exclude);
  if (globs.length === 0) return () => false;
  const matches = picomatch(globs, {
    dot: true,
    nobrace: true,
    nobracket: true,
    nocase: options.caseSensitive === false,
    noextglob: true,
    nonegate: true,
  });
  return (candidate) => matches(normalizePathFragment(candidate));
}

export function pathMatchesWorkspaceExclude(
  candidate: string,
  exclude: readonly string[],
  options: { readonly caseSensitive?: boolean } = {},
): boolean {
  return createWorkspaceExcludeMatcher(exclude, options)(candidate);
}
