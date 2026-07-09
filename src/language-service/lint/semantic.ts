// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Run the semantic lint rules over a program's inert definitions. Bang forms are ignored, so linting never
// runs user queries. These checks used to execute a MeTTa rule module through the interpreter; current
// MeTTaLingo makes that path too slow for editor background diagnostics, so the fixed rule set is implemented
// directly over the parsed atoms.

import { type Atom, DEFAULT_FUEL, format, parseAll, standardTokenizer } from "@metta-ts/core";
import type { LintSeverity } from "../config.js";

export interface SemanticViolation {
  readonly rule: string;
  readonly severity: string;
  readonly symbol: string;
  readonly message: string;
}

const TOKENIZER = standardTokenizer();
type SemanticRule = "missing-recursive-type" | "inconsistent-arity";

const DEFAULT_SEVERITY: Record<SemanticRule, LintSeverity> = {
  "missing-recursive-type": "deny",
  "inconsistent-arity": "deny",
};

const MESSAGE: Record<SemanticRule, string> = {
  "missing-recursive-type": "recursive function has no type declaration (exponential blowup risk)",
  "inconsistent-arity": "function has clauses with different arities",
};

interface ParsedProgramFacts {
  readonly typeDeclarations: ReadonlySet<string>;
  readonly definitions: readonly DefinitionFact[];
}

interface DefinitionFact {
  readonly name: string;
  readonly arity: number;
  readonly body: Atom | undefined;
}

function atomText(atom: Atom | undefined): string {
  if (atom === undefined) return "";
  return atom.kind === "sym" ? atom.name : stripQuotes(format(atom));
}

function stripQuotes(text: string): string {
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
}

function expressionHead(atom: Atom): string | null {
  if (atom.kind === "sym") return atom.name;
  if (atom.kind !== "expr") return null;
  return atom.items[0]?.kind === "sym" ? atom.items[0].name : null;
}

function definitionName(atom: Atom | undefined): string | null {
  if (atom === undefined) return null;
  if (atom.kind === "expr") return atomText(atom.items[0]);
  return atomText(atom);
}

function definitionArity(atom: Atom | undefined): number {
  return atom?.kind === "expr" ? Math.max(0, atom.items.length - 1) : 0;
}

function containsSymbol(atom: Atom | undefined, name: string): boolean {
  if (atom === undefined) return false;
  if (atom.kind === "sym") return atom.name === name;
  if (atom.kind !== "expr") return false;
  return atom.items.some((item) => containsSymbol(item, name));
}

function ruleSeverity(
  rule: SemanticRule,
  severities: Readonly<Record<string, LintSeverity>>,
): LintSeverity {
  return severities[rule] ?? DEFAULT_SEVERITY[rule];
}

function shouldCheck(
  rule: SemanticRule,
  severities: Readonly<Record<string, LintSeverity>>,
): boolean {
  const severity = ruleSeverity(rule, severities);
  return severity !== "off" && severity !== "allow";
}

function violation(
  rule: SemanticRule,
  symbol: string,
  severities: Readonly<Record<string, LintSeverity>>,
): SemanticViolation {
  return {
    rule,
    severity: ruleSeverity(rule, severities),
    symbol,
    message: MESSAGE[rule],
  };
}

function parseProgramFacts(programSource: string): ParsedProgramFacts | null {
  const typeDeclarations = new Set<string>();
  const definitions: DefinitionFact[] = [];
  try {
    for (const top of parseAll(programSource, TOKENIZER)) {
      if (top.bang) continue;
      const atom = top.atom;
      if (atom.kind !== "expr") continue;
      const head = expressionHead(atom);
      if (head === ":") {
        const name = atomText(atom.items[1]);
        if (name.length > 0) typeDeclarations.add(name);
      } else if (head === "=") {
        const name = definitionName(atom.items[1]);
        if (name === null || name.length === 0) continue;
        definitions.push({
          name,
          arity: definitionArity(atom.items[1]),
          body: atom.items[2],
        });
      }
    }
  } catch {
    return null;
  }
  return { typeDeclarations, definitions };
}

export function runSemanticLint(
  programSource: string,
  severities: Readonly<Record<string, LintSeverity>> = {},
  fuel = DEFAULT_FUEL,
): SemanticViolation[] {
  void fuel;
  const facts = parseProgramFacts(programSource);
  if (facts === null || facts.definitions.length === 0) return [];
  const seen = new Set<string>();
  const violations: SemanticViolation[] = [];

  if (shouldCheck("missing-recursive-type", severities)) {
    for (const def of facts.definitions) {
      if (facts.typeDeclarations.has(def.name) || !containsSymbol(def.body, def.name)) continue;
      const key = `missing-recursive-type\0${def.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation("missing-recursive-type", def.name, severities));
    }
  }

  if (shouldCheck("inconsistent-arity", severities)) {
    const aritiesByName = new Map<string, Set<number>>();
    for (const def of facts.definitions) {
      let arities = aritiesByName.get(def.name);
      if (arities === undefined) {
        arities = new Set();
        aritiesByName.set(def.name, arities);
      }
      arities.add(def.arity);
    }
    for (const [name, arities] of aritiesByName) {
      if (arities.size <= 1) continue;
      const key = `inconsistent-arity\0${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push(violation("inconsistent-arity", name, severities));
    }
  }

  return violations;
}
