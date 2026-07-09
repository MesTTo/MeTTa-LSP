// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Characterization of the edit, decoration, and call-hierarchy features on a two-file workspace with an
// import, a signatured function, a nested call, and a multi-line rewrite rule.

import { describe, expect, it } from "vitest";
import { Analyzer, SEMANTIC_TOKEN_TYPES } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

// Decode the delta-encoded LSP semantic token stream into { text, type } for each token.
function decodeSemanticTokens(
  data: readonly number[],
  src: string,
): { readonly text: string; readonly type: string }[] {
  const lines = src.split("\n");
  const out: { text: string; type: string }[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i] ?? 0;
    const deltaChar = data[i + 1] ?? 0;
    const length = data[i + 2] ?? 0;
    const typeIndex = data[i + 3] ?? 0;
    if (deltaLine === 0) char += deltaChar;
    else {
      line += deltaLine;
      char = deltaChar;
    }
    out.push({
      text: (lines[line] ?? "").slice(char, char + length),
      type: SEMANTIC_TOKEN_TYPES[typeIndex] ?? "?",
    });
  }
  return out;
}

const LIB = "file:///ws/lib.metta";
const MAIN = "file:///ws/main.metta";

const libSrc = "(: helper (-> Number Number))\n(= (helper $x) (+ $x 1))";
const mainSrc = [
  '(import! &self "lib.metta")',
  "(: compute (-> Number Number))",
  "(= (compute $n)",
  "   (helper (* $n 2)))",
  "(compute 5)",
].join("\n");

function workspace(): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/lib.metta", libSrc);
  files.writeFile("/ws/main.metta", mainSrc);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(LIB, libSrc, 1, true);
  analyzer.updateDocument(MAIN, mainSrc, 1, true);
  return analyzer;
}

// `compute` head inside `(= (compute $n)` on line 2.
const computeDef = { line: 2, character: 4 };

describe("edits", () => {
  it("prepares and performs a rename of a symbol", () => {
    const analyzer = workspace();
    expect(analyzer.prepareRename(MAIN, computeDef)?.name).toBe("compute");
    const edit = analyzer.rename(MAIN, computeDef, "scale");
    expect(Object.keys(edit?.changes ?? {})).toContain(MAIN);
    const edits = edit?.changes?.[MAIN] ?? [];
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.every((textEdit) => textEdit.newText === "scale")).toBe(true);
  });

  it("reflows a short broken def onto one line when formatting", () => {
    // the def spans two lines but fits the width, so the width-driven formatter collapses it
    const edits = workspace().formatDocument(MAIN);
    expect(edits.length).toBe(1);
    expect(edits[0]?.newText).toContain("(= (compute $n) (helper (* $n 2)))");
    expect(edits[0]?.newText).not.toContain("\n   (helper");
  });

  it("offers the run code action on the runnable call, not on definitions", () => {
    const analyzer = workspace();
    const onCall = analyzer
      .codeActions(MAIN, { start: { line: 4, character: 1 }, end: { line: 4, character: 1 } })
      .map((action) => action.title);
    expect(onCall).toContain("Run");
    // A rewrite rule adds to the space instead of reducing, so Run is not offered on it.
    const onDef = analyzer
      .codeActions(MAIN, { start: computeDef, end: computeDef })
      .map((action) => action.title);
    expect(onDef).not.toContain("Run");
  });
});

describe("decorations", () => {
  it("produces a non-empty semantic token stream", () => {
    expect(workspace().semanticTokens(MAIN).data.length).toBeGreaterThan(0);
  });

  it("restricts range semantic tokens to the requested range", () => {
    const analyzer = workspace();
    const full = analyzer.semanticTokens(MAIN);
    const firstLine = analyzer.semanticTokens(MAIN, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 100 },
    });
    expect(firstLine.data.length).toBeGreaterThan(0);
    expect(firstLine.data.length).toBeLessThan(full.data.length);
    // The token stream is [deltaLine, deltaChar, length, type, modifiers] quintuples. With every token on
    // line 0, the first deltaLine is 0 and each subsequent one is 0 too (relative to the previous token).
    for (let index = 0; index < firstLine.data.length; index += 5) {
      expect(firstLine.data[index]).toBe(0);
    }
  });

  it("colours function heads and definitions distinctly from operands", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/f.metta";
    const src = "(= (double $x) (* 2 $x))\n(double thing)";
    files.writeFile("/ws/f.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const decoded = decodeSemanticTokens(analyzer.semanticTokens(uri).data, src);
    // `double` is a function at both its definition head and its call.
    const doubles = decoded.filter((token) => token.text === "double");
    expect(doubles).toHaveLength(2);
    expect(doubles.every((token) => token.type === "function")).toBe(true);
    // `$x` is a variable; `thing` is an operand and gets no token, so it does not read as a function.
    expect(decoded.find((token) => token.text === "$x")?.type).toBe("variable");
    expect(decoded.some((token) => token.text === "thing")).toBe(false);
  });

  it("does not let semantic tokens colour the comment tail after a semicolon", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/comment-tail.metta";
    const src = "(= (e)\n   $w;this tail is commented out\n)";
    files.writeFile("/ws/comment-tail.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const decoded = decodeSemanticTokens(analyzer.semanticTokens(uri).data, src);

    expect(decoded).toContainEqual({ text: "$w", type: "variable" });
    expect(decoded.some((token) => token.text.includes(";this"))).toBe(false);
    expect(decoded.some((token) => token.text === "tail")).toBe(false);
  });

  it("uses MeTTa-specific semantic token buckets for special forms and operators", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/semantics.metta";
    const src = [
      "(: f (-> Number Number))",
      "(: predicate (-> Atom Bool))",
      "(: Shape Type)",
      "!(if True 1 2)",
      "!(case 1 (1 ok))",
      "!(switch 1 ((1 ok)))",
      "!(let $x 1 $x)",
      "!(match &self (parent Tom $x) $x)",
      "!(import! &self lib)",
      "!(eval (quote (f 1)))",
      "!(noeval (f 1))",
      "!(add-atom &self (parent Tom Bob))",
      "!(sqrt-math 4)",
      "!(length (a b))",
      "!(is-var $x)",
      "!(assertEqual (+ 1 1) 2)",
      "!(+ 1 2)",
      "!(<= 1 2)",
      "!(and True False)",
      "(:: x)",
    ].join("\n");
    files.writeFile("/ws/semantics.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const decoded = decodeSemanticTokens(analyzer.semanticTokens(uri).data, src);
    const typeOf = (text: string) => decoded.find((token) => token.text === text)?.type;

    expect(typeOf(":")).toBe("mettaTypeOperator");
    expect(typeOf("->")).toBe("mettaTypeOperator");
    expect(typeOf("Number")).toBe("type");
    expect(typeOf("Atom")).toBe("type");
    expect(typeOf("Bool")).toBe("type");
    expect(typeOf("Shape")).toBe("type");
    expect(typeOf("True")).toBe("type");
    expect(typeOf("if")).toBe("mettaControlFlow");
    expect(typeOf("case")).toBe("mettaControlFlow");
    expect(typeOf("switch")).toBe("mettaControlFlow");
    expect(typeOf("let")).toBe("mettaBinding");
    expect(typeOf("match")).toBe("mettaPattern");
    expect(typeOf("import!")).toBe("mettaModule");
    expect(typeOf("eval")).toBe("mettaEvaluation");
    expect(typeOf("quote")).toBe("mettaQuote");
    expect(typeOf("noeval")).toBe("mettaQuote");
    expect(typeOf("add-atom")).toBe("mettaEffect");
    expect(typeOf("sqrt-math")).toBe("mettaMathFunction");
    expect(typeOf("length")).toBe("mettaCollectionFunction");
    expect(typeOf("is-var")).toBe("mettaPredicateFunction");
    expect(typeOf("assertEqual")).toBe("mettaAssertion");
    expect(typeOf("+")).toBe("mettaArithmeticOperator");
    expect(typeOf("<=")).toBe("mettaComparisonOperator");
    expect(typeOf("and")).toBe("mettaLogicalOperator");
    expect(decoded.some((token) => token.text === "::")).toBe(false);
  });

  it("folds the multi-line rewrite rule", () => {
    const folds = workspace().foldingRanges(MAIN);
    expect(folds.some((fold) => fold.startLine === 2 && fold.endLine === 3)).toBe(true);
  });

  it("links the import to its resolved file", () => {
    expect(workspace().documentLinks(MAIN).length).toBe(1);
  });

  it("shows parameter-name and return-type inlay hints", () => {
    const labels = workspace()
      .inlayHints(MAIN, { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } })
      .map((hint) => hint.label);
    expect(labels).toContain("Number:");
    expect(labels).toContain(": Number");
  });

  it("suppresses inlay hints when metta.inlayHints.enabled is off", () => {
    const analyzer = workspace();
    const range = { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } };
    expect(analyzer.inlayHints(MAIN, range).length).toBeGreaterThan(0);
    analyzer.updateSettings({ inlayHints: { enabled: false } });
    expect(analyzer.inlayHints(MAIN, range)).toStrictEqual([]);
  });

  it("emits ▶ Run and ↝ Trace on the runnable call and a reference-count lens per definition", () => {
    const lenses = workspace().codeLenses(MAIN);
    const runs = lenses.filter((lens) => lens.command?.command === "metta.run");
    const traces = lenses.filter((lens) => lens.command?.command === "metta.trace");
    // Only the bare (compute 5) call is runnable; the import, type declaration, and rewrite rule are not.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.command?.title).toBe("▶ Run");
    expect(traces).toHaveLength(1);
    expect(traces[0]?.command?.title).toBe("↝ Trace");
    const runArg = runs[0]?.command?.arguments?.[0] as
      | { range?: { start: { line: number } } }
      | undefined;
    expect(runArg?.range?.start.line).toBe(4);
    const traceArg = traces[0]?.command?.arguments?.[0] as
      | { range?: { start: { line: number } } }
      | undefined;
    expect(traceArg?.range?.start.line).toBe(4);
    const references = lenses.find((lens) => lens.command?.command === "metta.showReferences");
    expect(references?.command?.title).toContain("reference");
    // The reference lens must carry the located ranges so the client can open the peek, and the old
    // do-nothing metta.noop target (which errored when clicked) must be gone.
    expect(references?.command?.arguments?.[0]).toHaveProperty("locations");
    expect(lenses.some((lens) => lens.command?.command === "metta.noop")).toBe(false);
  });

  it("offers ▶ Run on bang queries and bare calls, never on definitions or directives", () => {
    const files = new InMemoryFileProvider("/ws");
    const uri = "file:///ws/r.metta";
    const src = '(= (f $x) $x)\n!(f 1)\n(f 2)\n!42\n(: g Type)\n(import! &self "lib.metta")';
    files.writeFile("/ws/r.metta", src);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument(uri, src, 1, true);
    const spans = analyzer
      .codeLenses(uri)
      .filter(
        (lens) => lens.command?.command === "metta.run" || lens.command?.command === "metta.trace",
      )
      .map((lens) => {
        const arg = lens.command?.arguments?.[0] as {
          range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
          };
        };
        return [
          arg.range.start.line,
          arg.range.start.character,
          arg.range.end.line,
          arg.range.end.character,
        ];
      });
    expect(spans).toStrictEqual([
      [1, 0, 1, 6], // !(f 1) — the marker and its form run as one query
      [1, 0, 1, 6],
      [2, 0, 2, 5], // (f 2) — bare call, bang-wrapped when run
      [2, 0, 2, 5],
      [3, 0, 3, 3], // !42 — fused bang query
      [3, 0, 3, 3],
    ]);
  });

  it("explains a rewrite rule in prose", () => {
    const explanation = workspace().explainAt(MAIN, { line: 2, character: 1 });
    expect(explanation?.kind).toBe("definition");
    expect(explanation?.text).toContain("Rewrite rule");
  });

  it("expands selection ranges from a nested atom outward", () => {
    const [selection] = workspace().selectionRanges(MAIN, [{ line: 3, character: 12 }]);
    expect(selection).toBeDefined();
    expect(selection?.parent).toBeDefined();
  });
});

describe("call hierarchy", () => {
  it("prepares a call-hierarchy item and lists outgoing calls", () => {
    const analyzer = workspace();
    const [item] = analyzer.prepareCallHierarchy(MAIN, computeDef);
    expect(item?.name).toBe("compute");
    const outgoing = analyzer.outgoingCalls(item!).map((call) => call.to.name);
    expect(outgoing).toContain("helper");
  });
});
