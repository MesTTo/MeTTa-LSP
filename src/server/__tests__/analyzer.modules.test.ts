// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Built-in module awareness: when a file imports json/catalog/fileio, the module's declared symbols are
// known (no undefined-symbol warning), the import resolves (no import.unresolved), and each symbol hovers
// with its interpreter type and @doc. Using a module symbol without importing the module is still flagged.
// The module names and symbols come from @metta-ts/core's builtinModules(), so this tracks the interpreter.

import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";

const URI = "file:///ws/m.metta";

function analyzerWith(text: string): Analyzer {
  const files = new InMemoryFileProvider("/ws");
  files.writeFile("/ws/m.metta", text);
  const analyzer = new Analyzer(files);
  analyzer.setWorkspaceRoots(["file:///ws"]);
  analyzer.updateDocument(URI, text, 1, true);
  return analyzer;
}

function codes(text: string): (string | number | undefined)[] {
  return analyzerWith(text)
    .validate(URI)
    .map((d) => d.code);
}

function hoverText(analyzer: Analyzer, line: number, character: number): string {
  const hover = analyzer.hover(URI, { line, character });
  return hover && typeof hover.contents === "object" && "value" in hover.contents
    ? hover.contents.value
    : "";
}

describe("built-in module awareness", () => {
  it("does not flag a module function when the file imports the module", () => {
    const text = '!(import! &self json)\n!(let $d (json-decode "{}") (json-encode $d))';
    expect(codes(text).filter((code) => String(code).startsWith("symbol."))).toEqual([]);
  });

  it("resolves a built-in module import instead of reporting it unresolved", () => {
    expect(codes('!(import! &self fileio)\n!(file-open! "/tmp/x" "cwt")')).not.toContain(
      "import.unresolved",
    );
  });

  it("hints to import the module when a module function is used without importing it", () => {
    // Without (import! &self json), json-encode is an unknown head — valid data in MeTTa, never an
    // "undefined" error. Because it is exactly a built-in module export, the LSP hints (not errors) to
    // import that module, and offers a quick-fix that inserts the import.
    const analyzer = analyzerWith("!(json-encode (1 2 3))");
    const diagnostics = analyzer.validate(URI);
    const hint = diagnostics.find((d) => d.code === "symbol.needsImport");
    expect(hint?.severity).toBe(DiagnosticSeverity.Hint);
    expect(hint?.message).toContain("import! &self json");
    const head = "!(json-encode (1 2 3))".indexOf("json-encode");
    const fix = analyzer
      .codeActions(URI, {
        start: { line: 0, character: head },
        end: { line: 0, character: head + "json-encode".length },
      })
      .find((action) => action.title.includes("json"));
    expect(fix?.edit?.changes?.[URI]?.[0]?.newText).toContain("(import! &self json)");
  });

  it("hovers a module function with its interpreter type and documentation", () => {
    const text = '!(import! &self json)\n!(let $d (json-decode "{}") (json-encode $d))';
    const analyzer = analyzerWith(text);
    const character = (text.split("\n")[1] ?? "").indexOf("json-encode") + 2;
    const value = hoverText(analyzer, 1, character);
    expect(value).toContain("(-> Atom String)");
    expect(value).toContain("encodes it to json");
  });

  it("builds interpreter declaration context from indexed top-level forms", () => {
    const files = new InMemoryFileProvider("/ws");
    const lib = "(: helper (-> Number Number))\n(= (helper $x) (+ $x 1))\n!(debug! should-not-run)";
    const main =
      "!(import! &self lib)\n!(import! &self json)\n(= (main $x) (json-encode (helper $x)))";
    files.writeFile("/ws/lib.metta", lib);
    files.writeFile("/ws/main.metta", main);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/main.metta", main, 1, true);

    const context = analyzer.declarationContextForDocs("file:///ws/main.metta");

    expect(context).toContain("(: helper (-> Number Number))");
    expect(context).toContain("(= (helper $x) (+ $x 1))");
    expect(context).toContain("!(import! &self json)");
    expect(context).toContain("(= (main $x) (json-encode (helper $x)))");
    expect(context).not.toContain("!(import! &self lib)");
    expect(context).not.toContain("should-not-run");
  });
});

describe("PeTTa (library …) imports", () => {
  // (library <name>) resolves by the bare library name — from the workspace root or a conventional lib/ dir —
  // and is keyed under that name so core's import! loads it.
  function libraryAnalyzer(libPath: string): Analyzer {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile(libPath, "(= (myfn $x) (* $x 10))");
    const main = "!(import! &self (library mymod))\n!(myfn 5)";
    files.writeFile("/ws/main.metta", main);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/main.metta", main, 1, true);
    return analyzer;
  }

  it("resolves (library <name>) by the bare name from the workspace root", () => {
    const analyzer = libraryAnalyzer("/ws/mymod.metta");
    expect(analyzer.validate("file:///ws/main.metta").map((d) => d.code)).not.toContain(
      "import.unresolved",
    );
    expect(Object.keys(analyzer.importSourceMap("file:///ws/main.metta"))).toContain("mymod");
  });

  it("resolves (library <name>) from a conventional lib/ subdirectory", () => {
    const analyzer = libraryAnalyzer("/ws/lib/mymod.metta");
    expect(analyzer.validate("file:///ws/main.metta").map((d) => d.code)).not.toContain(
      "import.unresolved",
    );
    expect(Object.keys(analyzer.importSourceMap("file:///ws/main.metta"))).toContain("mymod");
  });

  it("resolves (library <name>) from a git-fetched repo under repos/", () => {
    // git-import! clones shallow checkouts into repos/<repo>/; a library file inside resolves by name.
    const analyzer = libraryAnalyzer("/ws/repos/test_metta_lib/mymod.metta");
    expect(analyzer.validate("file:///ws/main.metta").map((d) => d.code)).not.toContain(
      "import.unresolved",
    );
    expect(Object.keys(analyzer.importSourceMap("file:///ws/main.metta"))).toContain("mymod");
  });

  it("flags an unresolvable library like any other import", () => {
    const files = new InMemoryFileProvider("/ws");
    const main = "!(import! &self (library nosuchlib))";
    files.writeFile("/ws/main.metta", main);
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws"]);
    analyzer.updateDocument("file:///ws/main.metta", main, 1, true);
    expect(analyzer.validate("file:///ws/main.metta").map((d) => d.code)).toContain(
      "import.unresolved",
    );
  });
});
