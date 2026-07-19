// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathToUri } from "../../language-service/index.js";
import { applyDocumentEdits } from "../applyEdits.js";

interface JsonRpcResponse {
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

interface PendingResponse {
  readonly resolve: (response: JsonRpcResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ToolCallResult {
  readonly structuredContent?: unknown;
}

interface AppliedSummary {
  readonly files: readonly string[];
  readonly changed: boolean;
}

interface EditToolResult {
  readonly applied?: AppliedSummary;
  readonly error?: string;
}

const CODE_ACTION_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 30 },
} as const;
const clients: McpClient[] = [];
const workspaces: string[] = [];

class McpClient {
  private nextId = 1;
  private stdout = "";
  private readonly pending = new Map<number, PendingResponse>();
  public stderr = "";

  public constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    child.on("exit", (code, signal) => {
      const error = new Error(
        `MCP server exited before responding: code=${code ?? "null"} signal=${signal ?? "null"} stderr=${this.stderr}`,
      );
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  public request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out. stderr=${this.stderr}`));
      }, 5_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  public async tool(name: string, args: unknown): Promise<unknown> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(response.error.message);
    return (response.result as ToolCallResult).structuredContent;
  }

  public async stop(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode === null && !this.child.killed) this.child.kill();
    if (this.child.exitCode === null)
      await Promise.race([
        once(this.child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
  }

  private handleStdout(chunk: string): void {
    this.stdout += chunk;
    let newline = this.stdout.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      if (line.length > 0) this.handleLine(line);
      newline = this.stdout.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    const response = JSON.parse(line) as JsonRpcResponse;
    if (typeof response.id !== "number") return;
    const pending = this.pending.get(response.id);
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve(response);
  }
}

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "metta-lsp-mcp-"));
  workspaces.push(dir);
  return dir;
}

function codeActionInput(applyCodeAction: string): unknown {
  return { filePath: "main.metta", range: CODE_ACTION_RANGE, applyCodeAction };
}

async function withClient<T>(root: string, run: (client: McpClient) => Promise<T>): Promise<T> {
  const serverPath = path.join(process.cwd(), "dist/mcp/server.js");
  const client = new McpClient(spawn(process.execPath, [serverPath, "--workspace", root]));
  clients.push(client);
  const init = await client.request("initialize", {});
  if (init.error) throw new Error(init.error.message);
  return run(client);
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MCP edit tools apply edits to disk", () => {
  it("lsp_format writes the formatted document", async () => {
    const root = workspace();
    const file = path.join(root, "main.metta");
    writeFileSync(file, "(= (sum $x)\n(+ $x 1))\n", "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_format", { filePath: "main.metta" }),
    )) as EditToolResult;

    expect(result.applied?.changed).toBe(true);
    expect(result.applied?.files).toStrictEqual([file]);
    expect(readFileSync(file, "utf8")).toBe("(= (sum $x) (+ $x 1))\n");
  });

  it("lsp_format_range writes the selected formatted range", async () => {
    const root = workspace();
    const file = path.join(root, "main.metta");
    writeFileSync(file, "(= (a)\n1)\n(= (b)\n2)\n", "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_format_range", {
        filePath: "main.metta",
        range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
      }),
    )) as EditToolResult;

    expect(result.applied?.changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("(= (a) 1)\n(= (b)\n2)\n");
  });

  it("lsp_organize_imports writes the sorted import block", async () => {
    const root = workspace();
    writeFileSync(path.join(root, "a.metta"), "(= (a) 1)\n", "utf8");
    writeFileSync(path.join(root, "z.metta"), "(= (z) 1)\n", "utf8");
    const file = path.join(root, "main.metta");
    writeFileSync(file, "!(import! &self z)\n!(import! &self a)\n(= (main) (a))\n", "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_organize_imports", { filePath: "main.metta" }),
    )) as EditToolResult;

    expect(result.applied?.changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(
      "!(import! &self a)\n!(import! &self z)\n(= (main) (a))\n",
    );
  });

  it("lsp_rename writes every file in the WorkspaceEdit", async () => {
    const root = workspace();
    const defs = path.join(root, "defs.metta");
    const main = path.join(root, "main.metta");
    writeFileSync(defs, "(: compute (-> Number Number))\n(= (compute $x) (+ $x 1))\n", "utf8");
    writeFileSync(main, '!(import! &self "defs.metta")\n!(compute 1)\n', "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_rename", {
        filePath: "main.metta",
        position: { line: 1, character: 3 },
        newName: "scale",
      }),
    )) as EditToolResult;

    expect(result.applied?.changed).toBe(true);
    expect(new Set(result.applied?.files)).toStrictEqual(new Set([defs, main]));
    expect(readFileSync(defs, "utf8")).toBe(
      "(: scale (-> Number Number))\n(= (scale $x) (+ $x 1))\n",
    );
    expect(readFileSync(main, "utf8")).toBe('!(import! &self "defs.metta")\n!(scale 1)\n');
  });

  it("lsp_code_actions applies only the selected action title", async () => {
    const root = workspace();
    const file = path.join(root, "main.metta");
    writeFileSync(file, "!(map-atom (a b) x (foo x))\n", "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_code_actions", codeActionInput("Change 'x' to '$x'")),
    )) as EditToolResult;

    expect(result.error).toBeUndefined();
    expect(result.applied?.changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("!(map-atom (a b) $x (foo x))\n");
  });

  it("lsp_code_actions reports an unmatched selected action without writing", async () => {
    const root = workspace();
    const file = path.join(root, "main.metta");
    const source = "!(map-atom (a b) x (foo x))\n";
    writeFileSync(file, source, "utf8");

    const result = (await withClient(root, (client) =>
      client.tool("lsp_code_actions", codeActionInput("No such action")),
    )) as EditToolResult;

    expect(result.error).toBe("No code action titled 'No such action' was found.");
    expect(result.applied).toBeUndefined();
    expect(readFileSync(file, "utf8")).toBe(source);
  });

  it("rejects a target outside the workspace before writing", () => {
    const root = workspace();
    const outsideRoot = workspace();
    const outside = path.join(outsideRoot, "outside.metta");
    writeFileSync(outside, "(= (outside) 1)\n", "utf8");

    expect(() => applyDocumentEdits(pathToUri(outside), [], [root])).toThrow(
      `metta LSP will not modify a file outside the workspace: ${outside}`,
    );
  });
});
