import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer.js";
import { InMemoryFileProvider } from "../fileProvider.js";
import { runLspToolOperation } from "../lspTool.js";

describe("agent LSP tool", () => {
  it("groups workspace symbols by file and accepts workspaceRoot without a document", async () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/a.metta", "(: square Type)\n(: red-square square)");
    files.writeFile("/ws/b.metta", "(= (square-area $x) (* $x $x))");
    files.writeFile("/other/c.metta", "(: other-square Type)");
    const analyzer = new Analyzer(files);
    analyzer.setWorkspaceRoots(["file:///ws", "file:///other"]);
    await analyzer.scanWorkspace();

    const result = await runLspToolOperation(analyzer, {
      operation: "workspaceSymbol",
      workspaceRoot: "/ws",
      query: "square",
    });
    const workspaceSymbols = (result as { metadata: { result: unknown } }).metadata.result as {
      count: number;
      fields: readonly string[];
      files: { path: string; rows: unknown[][] }[];
    };

    expect(workspaceSymbols.fields).toStrictEqual(["name", "kind", "line", "char"]);
    expect(workspaceSymbols.count).toBe(3);
    expect(workspaceSymbols.files.map((file) => file.path).sort()).toStrictEqual([
      "a.metta",
      "b.metta",
    ]);
    expect(JSON.stringify(workspaceSymbols)).not.toContain("file://");
    expect(JSON.stringify(workspaceSymbols)).not.toContain("/other");
    expect(workspaceSymbols.files.flatMap((file) => file.rows)).toContainEqual([
      "square",
      "type",
      1,
      4,
    ]);
  });

  it("keeps raw SymbolInformation available when requested", async () => {
    const files = new InMemoryFileProvider("/ws");
    files.writeFile("/ws/a.metta", "(: square Type)");
    const analyzer = new Analyzer(files);

    const result = await runLspToolOperation(analyzer, {
      operation: "workspaceSymbol",
      workspaceRoot: "/ws",
      query: "square",
      resultFormat: "lsp",
    });
    const workspaceSymbols = (result as { metadata: { result: unknown } }).metadata.result as {
      location?: unknown;
    }[];

    expect(workspaceSymbols[0]?.location).toBeDefined();
  });
});
