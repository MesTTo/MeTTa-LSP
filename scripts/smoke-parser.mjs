import { format, parseAll, standardTokenizer } from "@metta-ts/core";
import { parseMeTTa } from "../dist/server/parser.js";

const cases = [
  "(, (Implies $a $b) (Fact $a))",
  "([] {} ,)",
  "!(+ 1 2)\n(= (fact 0) 1)\n(= (fact $n) (* $n (fact (- $n 1))))",
  '(js-atom "Math.max")',
  "(= (with-braces {x}) [,])",
];

for (const source of cases) {
  const core = parseAll(source, standardTokenizer());
  const parsed = parseMeTTa("file:///smoke.metta", source, 1);
  if (parsed.diagnostics.some((d) => d.severity === 1 || d.code?.startsWith("syntax."))) {
    throw new Error(
      `parser reported unexpected diagnostics for ${source}: ${JSON.stringify(parsed.diagnostics)}`,
    );
  }
  if (core.length === 0) throw new Error(`core parser produced no atoms for ${source}`);
}

const comma = parseMeTTa("file:///comma.metta", "(, a b)").tokens.map((t) => t.text);
if (!comma.includes(","))
  throw new Error(`comma disappeared from token stream: ${JSON.stringify(comma)}`);

const bracketTokens = parseMeTTa("file:///brackets.metta", "([] {})").tokens.map(
  (t) => `${t.type}:${t.text}`,
);
if (!bracketTokens.includes("symbol:[]") || !bracketTokens.includes("symbol:{}")) {
  throw new Error(
    `square/curly bracket atoms should be symbols in core dialect: ${JSON.stringify(bracketTokens)}`,
  );
}

const normalized = format(parseAll("(, a b)", standardTokenizer())[0].atom);
if (normalized !== "(, a b)") throw new Error(`core parser sanity failed: ${normalized}`);
console.error("parser smoke ok");
