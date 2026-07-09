// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Every user-facing diagnostic message and code-action title, in one place. The analyzer builds strings by
// calling these, never inline, so the phrasing is defined once: it stays consistent across the diagnostics,
// the hover, and the code actions, and a wording change is a single edit here rather than a hunt through the
// analyzer. Each key names the diagnostic code or the action it renders.

// Diagnostic messages, one per analyzer diagnostic code.
export const diagnosticMessage = {
  unresolvedImport: (rawPath: string): string =>
    `Import target '${rawPath}' could not be resolved.`,

  unbangedImport: (rawPath: string): string =>
    `This import does not run: without a leading !, a top-level (import! …) is inert data, so ${rawPath}'s symbols stay undefined at runtime. Prefix it with ! to run it.`,

  duplicateDefinition: (kind: string, name: string, arity: number | undefined): string =>
    `Duplicate ${kind} definition '${name}' with arity ${arity ?? "unknown"}.`,

  // An unknown head is valid data in MeTTa (it reduces to itself), so this is a hint, not an error: only a
  // near-miss of a known name is worth surfacing, framed as a suggestion.
  possibleTypo: (name: string, suggestion: string): string =>
    `'${name}' is not a known function; did you mean '${suggestion}'? (An unknown symbol is treated as data in MeTTa.)`,

  // An unknown head that is exactly a built-in module's export: the precise fix is to import that module.
  needsImport: (name: string, module: string): string =>
    `'${name}' is a function of the built-in '${module}' module; import it with (import! &self ${module}) to use it. (Until then it is an unknown symbol, treated as data.)`,

  // An unknown head that is exactly a symbol another workspace file defines: import that file to reach it.
  needsImportFrom: (name: string, importPath: string): string =>
    `'${name}' is defined in '${importPath}'; import it with (import! &self "${importPath}") to use it. (Until then it is an unknown symbol, treated as data.)`,

  // The signature, when known, teaches the call's shape (arity and parameter types), the way MeTTaTron's arity
  // errors show a usage line.
  argumentCountMismatch: (
    name: string,
    expected: string,
    actual: number,
    signature?: string,
  ): string =>
    `Argument count mismatch for '${name}': expected ${expected}, got ${actual}.${
      signature !== undefined ? ` Its type is ${signature}.` : ""
    }`,

  typeMismatch: (name: string, argIndex: number, expected: string, actual: string): string =>
    `Type mismatch for '${name}' argument ${argIndex}: expected ${expected}, got ${actual}.`,

  returnTypeMismatch: (name: string, expected: string, actual: string): string =>
    `Type mismatch for '${name}': the result is ${actual}, but ${expected} is expected here.`,

  // A parameter the interpreter types `Variable` binds a $-variable. A plain symbol there type-checks (Hyperon
  // accepts an untyped symbol) but does not reduce at run time, so the LSP flags it, with a $-prefixed
  // suggestion when the symbol looks like a forgotten `$`.
  variableSlot: (name: string, argIndex: number, suggestion: string | undefined): string =>
    suggestion !== undefined
      ? `'${name}' argument ${argIndex} must be a variable (one starting with $) — did you mean '${suggestion}'?`
      : `'${name}' argument ${argIndex} must be a variable (one starting with $); a plain symbol does not reduce here.`,

  undefinedType: (typeName: string, signatureName: string, suggestion?: string): string =>
    `Undefined type '${typeName}' in signature for '${signatureName}'.${
      suggestion === undefined
        ? ""
        : suggestion.toLowerCase() === typeName.toLowerCase()
          ? ` Type names are capitalized — did you mean '${suggestion}'?`
          : ` Did you mean '${suggestion}'?`
    }`,

  unboundSpace: (name: string, suggestion?: string): string =>
    `Unbound atom-space symbol '${name}'.${
      suggestion === undefined
        ? ""
        : suggestion.toLowerCase() === name.toLowerCase()
          ? ` Space names are case-sensitive — did you mean '${suggestion}'?`
          : ` Did you mean '${suggestion}'?`
    }`,

  undefinedVariable: (name: string): string => `Undefined variable '${name}'.`,

  reservedHash: (name: string): string =>
    `Variable '${name}' contains '#', which is reserved in many MeTTa parsers.`,

  suspiciousSemicolon: (name: string): string =>
    `Variable '${name}' contains or is immediately followed by ';', which starts a comment in many MeTTa parsers; the rest of the line is ignored.`,

  // Host-bridge (TypeScript host operation ↔ MeTTa) type checks.
  hostArgumentType: (name: string, expected: string, argIndex: number, actual: string): string =>
    `Host operation \`${name}\` expects ${expected} for argument ${argIndex}, but got ${actual}.`,

  hostDeclaredArgument: (argIndex: number, declared: string, hostType: string): string =>
    `MeTTa declares argument ${argIndex} as ${declared}, but the host type is ${hostType}.`,

  hostDeclaredReturn: (declared: string, hostReturn: string): string =>
    `MeTTa declares the return type as ${declared}, but the host returns ${hostReturn}.`,

  prologSourceDiagnostic: (
    rawPath: string,
    line: number,
    character: number,
    message: string,
  ): string => `Prolog diagnostic in '${rawPath}' at ${line}:${character}: ${message}`,
  unresolvedPrologFile: (rawPath: string): string =>
    `Prolog file '${rawPath}' could not be resolved from this MeTTa file or the current workspace.`,
} as const;

// Code-action titles.
export const codeActionTitle = {
  suppress: (code: string): string => `Suppress ${code} on this line`,

  applySuggestion: (name: string, suggestion: string): string =>
    `Change '${name}' to '${suggestion}'`,

  importSymbol: (name: string, importPath: string): string => `Import '${name}' from ${importPath}`,

  importBuiltinModule: (module: string): string => `Import the built-in '${module}' module`,

  runImport: (): string => "Add ! to run this import",

  addTypeDeclaration: (name: string): string =>
    `Add type declaration for '${name}' (typed functions interpret faster)`,

  applyLintFix: (ruleId: string): string => `${ruleId}: apply fix`,

  organizeImports: "Organize MeTTa imports",
} as const;
