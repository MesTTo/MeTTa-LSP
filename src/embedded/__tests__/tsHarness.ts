// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Shared in-memory TypeScript language service for the embedded integration tests: a real ts.LanguageService
// over a single .ts file (with lib.d.ts read from disk), plus the minimal `project` shim the template
// decorator's source helper needs (its two ScriptInfo methods, backed by the real source file's positions).

import * as ts from "typescript";

export function inMemoryLanguageService(fileName: string, text: string): ts.LanguageService {
  const snapshot = ts.ScriptSnapshot.fromString(text);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) =>
      name === fileName ? snapshot : ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? ""),
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({ allowJs: false, noLib: false }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (name) => name === fileName || ts.sys.fileExists(name),
    readFile: (name) => (name === fileName ? text : ts.sys.readFile(name)),
  };
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

export function stubProject(service: ts.LanguageService, fileName: string): ts.server.Project {
  const sourceFile = service.getProgram()?.getSourceFile(fileName);
  const scriptInfo = {
    positionToLineOffset: (position: number) => {
      const at = sourceFile
        ? ts.getLineAndCharacterOfPosition(sourceFile, position)
        : { line: 0, character: 0 };
      return { line: at.line + 1, offset: at.character + 1 };
    },
    lineOffsetToPosition: (line: number, offset: number) =>
      sourceFile ? ts.getPositionOfLineAndCharacter(sourceFile, line - 1, offset - 1) : 0,
  };
  return {
    getScriptInfo: (name: string) => (name === fileName ? scriptInfo : undefined),
    getLanguageService: () => service,
  } as unknown as ts.server.Project;
}
