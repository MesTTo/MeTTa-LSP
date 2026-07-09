// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Find the MeTTa source that lives in plain string arguments of the eDSL, which the tagged-template decorator
// cannot see: parseSource("..."), db.q("..."), db.run("..."). Only files that import @metta-ts/edsl are
// considered, so an unrelated `.q`/`.run` in another library is left alone. A string with escape sequences is
// skipped: its unescaped value differs from the source text, so body positions would not map linearly back to
// the .ts file, and MeTTa query strings are escape-free in practice.

import type * as ts from "typescript";

export interface MettaStringRegion {
  readonly node: ts.StringLiteral;
  readonly text: string;
  readonly contentStart: number;
  readonly contentEnd: number;
}

const EDSL_MODULE = "@metta-ts/edsl";
const CALLEES: ReadonlySet<string> = new Set(["parseSource", "q", "run"]);

function importsEdsl(typescript: typeof ts, sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      typescript.isImportDeclaration(statement) &&
      typescript.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === EDSL_MODULE,
  );
}

// The called name for either a bare call (`parseSource(...)`) or a method call (`db.q(...)`).
function calleeName(typescript: typeof ts, expression: ts.Expression): string | undefined {
  if (typescript.isIdentifier(expression)) return expression.text;
  if (typescript.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function isMettaStringArgument(typescript: typeof ts, node: ts.StringLiteral): boolean {
  const call = node.parent;
  return (
    typescript.isCallExpression(call) &&
    call.arguments.length >= 1 &&
    call.arguments[0] === node &&
    CALLEES.has(calleeName(typescript, call.expression) ?? "")
  );
}

export function findMettaStringRegions(
  typescript: typeof ts,
  sourceFile: ts.SourceFile,
): MettaStringRegion[] {
  if (!importsEdsl(typescript, sourceFile)) return [];
  const regions: MettaStringRegion[] = [];
  const visit = (node: ts.Node): void => {
    if (typescript.isStringLiteral(node) && isMettaStringArgument(typescript, node)) {
      // `getText` keeps the quotes and any escapes; when the unescaped value matches, the string is
      // escape-free and its characters line up one-to-one with the source.
      const raw = node.getText(sourceFile).slice(1, -1);
      if (raw === node.text) {
        const contentStart = node.getStart(sourceFile) + 1;
        regions.push({
          node,
          text: node.text,
          contentStart,
          contentEnd: contentStart + node.text.length,
        });
      }
    }
    typescript.forEachChild(node, visit);
  };
  typescript.forEachChild(sourceFile, visit);
  return regions;
}
