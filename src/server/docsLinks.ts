// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The single builtin/diagnostic → docs URL projection (mettadevpack contract-builtin-doc: one owner, no
// copies). Pure and browser-safe: it maps a builtin symbol or a diagnostic code to a URL under the
// configured docs base, so the hover's "Open docs" link, a diagnostic's codeDescription, and the docs
// site (Phase 5) stay in lockstep. An empty base means docs links are off; the base points wherever the
// site is deployed. This is the presentation side of the host boundary, never Hyperon.

// The diagnostic codes the docs site catalogs, one page per code. Kept here as the source of truth so a
// codeDescription is only attached when a real page exists (never a link to a 404). These are the
// analyzer's own semantic codes; syntax and lint-rule ids carry their own surfacing.
export const DOCUMENTED_DIAGNOSTIC_CODES: ReadonlySet<string> = new Set([
  "call.arity",
  "call.typeMismatch",
  "definition.duplicate",
  "import.unresolved",
  "import.notRun",
  "space.unbound",
  "symbol.possibleTypo",
  "symbol.needsImport",
  "type.undefined",
  "variable.undefined",
  "variable.reservedHash",
  "variable.suspiciousSemicolon",
]);

function trimTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

// A heading slug for a builtin: case-preserving, with runs of non-alphanumerics except `_` collapsed to a
// single hyphen, and a leading hyphen dropped. Preserving case keeps type constructors like `Empty` distinct
// from functions like `empty`. A trailing hyphen is kept, so names that differ only by trailing punctuation
// stay distinct anchors (include vs include!, let vs let*). Underscores are preserved so PeTTa-compatible
// spellings such as with_mutex do not collide with dashed TypeScript-native names such as with-mutex. A
// leading `@` maps to `at-` first, so a doc constructor stays distinct from a same-named function (@return
// vs return). Punctuation-only names (operators like `+`) slug to empty and link to the page without an
// anchor.
export function anchor(name: string): string {
  // Runs already collapse to a single hyphen, so removing one leading hyphen suffices (a single-character
  // match, so no backtracking).
  return name
    .replaceAll("@", "at-")
    .replaceAll(/[^A-Za-z0-9_]+/g, "-")
    .replace(/^-/, "");
}

// The docs URL for a builtin symbol, or null when the base is unset. Every builtin links to the reference
// page; a named builtin also jumps to its anchor.
export function builtinDocsUrl(baseUrl: string, name: string): string | null {
  if (baseUrl.length === 0) return null;
  const page = `${trimTrailingSlash(baseUrl)}/reference/builtins`;
  const slug = anchor(name);
  return slug.length > 0 ? `${page}#${slug}` : page;
}

// The docs URL for a diagnostic code, or null when the base is unset or the code has no catalog page.
export function diagnosticDocsUrl(baseUrl: string, code: string | undefined): string | null {
  if (baseUrl.length === 0 || code === undefined || !DOCUMENTED_DIAGNOSTIC_CODES.has(code)) {
    return null;
  }
  return `${trimTrailingSlash(baseUrl)}/diagnostics/${code}`;
}
