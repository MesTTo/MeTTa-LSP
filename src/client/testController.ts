// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The native VS Code Test Explorer for MeTTa. It discovers each bang assert form as a test (the pure
// `discoverTests`), and on a run it evaluates the file through the guarded runtime on the server, then maps
// each result back to its test with `classifyTestQueries`. Both the discovered forms and the classified
// results are in source order, so they line up by index without any fragile string matching.

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { classifyTestQueries, discoverTests } from "../language-service/index.js";
import {
  type GuardedEvaluationParams,
  GuardedEvaluationRequest,
  type GuardedEvaluationResultPayload,
} from "../server/shared/lspRequests.js";

function testId(uri: string, start: number): string {
  return `${uri}#${String(start)}`;
}

// Register a Test Explorer controller. `getClient` defers reading the language client until a run, since the
// client is created alongside this registration.
export function registerTestController(
  context: vscode.ExtensionContext,
  getClient: () => LanguageClient | undefined,
): vscode.TestController {
  const controller = vscode.tests.createTestController("metta", "MeTTa Tests");
  context.subscriptions.push(controller);

  const discover = (document: vscode.TextDocument): void => {
    if (document.languageId !== "metta") return;
    const uri = document.uri.toString();
    const tests = discoverTests(document.getText());
    if (tests.length === 0) {
      controller.items.delete(uri);
      return;
    }
    const fileItem =
      controller.items.get(uri) ??
      controller.createTestItem(uri, document.uri.path.split("/").pop() ?? uri, document.uri);
    fileItem.children.replace(
      tests.map((test) => {
        const item = controller.createTestItem(testId(uri, test.start), test.name, document.uri);
        item.range = new vscode.Range(
          document.positionAt(test.start),
          document.positionAt(test.end),
        );
        return item;
      }),
    );
    controller.items.add(fileItem);
  };

  const runHandler = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> => {
    const run = controller.createTestRun(request);
    const leaves: vscode.TestItem[] = [];
    const collect = (item: vscode.TestItem): void => {
      if (item.children.size > 0) item.children.forEach(collect);
      else leaves.push(item);
    };
    if (request.include) request.include.forEach(collect);
    else controller.items.forEach(collect);
    for (const leaf of leaves) run.enqueued(leaf);

    const uris = [
      ...new Set(leaves.map((leaf) => leaf.uri?.toString()).filter(Boolean)),
    ] as string[];
    for (const uri of uris) {
      if (token.isCancellationRequested) break;
      const byId = new Map(
        leaves.filter((leaf) => leaf.uri?.toString() === uri).map((leaf) => [leaf.id, leaf]),
      );
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
      const discovered = discoverTests(document.getText());
      for (const test of discovered) {
        const item = byId.get(testId(uri, test.start));
        if (item) run.started(item);
      }
      const params: GuardedEvaluationParams = { uri, includePriorDefinitions: true };
      const result = await getClient()?.sendRequest<GuardedEvaluationResultPayload>(
        GuardedEvaluationRequest,
        params,
      );
      const classified = result ? classifyTestQueries(result.queries) : [];
      discovered.forEach((test, index) => {
        const item = byId.get(testId(uri, test.start));
        if (!item) return;
        const outcome = classified[index];
        if (outcome === undefined) run.skipped(item);
        else if (outcome.status === "pass") run.passed(item);
        else if (outcome.status === "fail")
          run.failed(item, new vscode.TestMessage(outcome.message ?? "assertion failed"));
        else run.errored(item, new vscode.TestMessage(outcome.message ?? "unexpected result"));
      });
    }
    run.end();
  };

  controller.createRunProfile("Run", vscode.TestRunProfileKind.Run, runHandler, true);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(discover),
    vscode.workspace.onDidChangeTextDocument((event) => {
      discover(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      controller.items.delete(document.uri.toString());
    }),
  );
  for (const document of vscode.workspace.textDocuments) discover(document);
  return controller;
}
