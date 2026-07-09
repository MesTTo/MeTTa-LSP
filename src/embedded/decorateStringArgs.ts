// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Extend a TypeScript language service with MeTTa intelligence inside the eDSL's plain string arguments
// (parseSource("..."), db.q("..."), db.run("...")), which the tagged-template decorator does not reach. Each
// qualifying string is fed to the same MettaTemplateService the templates use, through a context whose
// `toOffset` returns file offsets directly: an escape-free string literal is single-line, so a body position
// maps to the file by `contentStart + character`, and results come back already anchored in the .ts file with
// no second repositioning. Requests outside a string region fall through to the wrapped service, so template
// and ordinary TypeScript behavior is untouched.

import type * as ts from "typescript";
import type { TemplateContext } from "typescript-template-language-service-decorator";
import { findMettaStringRegions, type MettaStringRegion } from "./mettaStringRegions.js";
import type { MettaTemplateService } from "./mettaTemplateService.js";

function contextFor(
  typescript: typeof ts,
  region: MettaStringRegion,
  fileName: string,
): TemplateContext {
  return {
    typescript,
    fileName,
    text: region.text,
    rawText: region.text,
    node: region.node,
    toOffset: (position: ts.LineAndCharacter) => region.contentStart + position.character,
    toPosition: (offset: number) => ({ line: 0, character: offset - region.contentStart }),
  } as unknown as TemplateContext;
}

export function decorateStringArgs(
  typescript: typeof ts,
  languageService: ts.LanguageService,
  templateService: MettaTemplateService,
): ts.LanguageService {
  const regionsOf = (fileName: string): MettaStringRegion[] => {
    const sourceFile = languageService.getProgram()?.getSourceFile(fileName);
    return sourceFile ? findMettaStringRegions(typescript, sourceFile) : [];
  };
  const regionAt = (fileName: string, position: number): MettaStringRegion | undefined =>
    regionsOf(fileName).find(
      (region) => position >= region.contentStart && position < region.contentEnd,
    );
  const body = (region: MettaStringRegion, position: number): ts.LineAndCharacter => ({
    line: 0,
    character: position - region.contentStart,
  });
  const ctx = (region: MettaStringRegion, fileName: string): TemplateContext =>
    contextFor(typescript, region, fileName);

  return {
    ...languageService,

    getSemanticDiagnostics(fileName) {
      const base = languageService.getSemanticDiagnostics(fileName);
      const metta = regionsOf(fileName).flatMap((region) =>
        templateService.getSemanticDiagnostics(ctx(region, fileName)),
      );
      return [...base, ...metta];
    },

    getQuickInfoAtPosition(fileName, position) {
      const region = regionAt(fileName, position);
      if (region === undefined) return languageService.getQuickInfoAtPosition(fileName, position);
      return (
        templateService.getQuickInfoAtPosition(ctx(region, fileName), body(region, position)) ??
        languageService.getQuickInfoAtPosition(fileName, position)
      );
    },

    getCompletionsAtPosition(fileName, position, options, formattingSettings) {
      const region = regionAt(fileName, position);
      if (region === undefined)
        return languageService.getCompletionsAtPosition(
          fileName,
          position,
          options,
          formattingSettings,
        );
      return templateService.getCompletionsAtPosition(
        ctx(region, fileName),
        body(region, position),
      );
    },

    getCompletionEntryDetails(fileName, position, name, formatOptions, source, preferences, data) {
      const region = regionAt(fileName, position);
      if (region === undefined)
        return languageService.getCompletionEntryDetails(
          fileName,
          position,
          name,
          formatOptions,
          source,
          preferences,
          data,
        );
      return templateService.getCompletionEntryDetails(
        ctx(region, fileName),
        body(region, position),
        name,
      );
    },

    getDefinitionAtPosition(fileName, position) {
      const region = regionAt(fileName, position);
      if (region === undefined) return languageService.getDefinitionAtPosition(fileName, position);
      const defs = templateService.getDefinitionAtPosition(
        ctx(region, fileName),
        body(region, position),
      );
      return defs.length > 0 ? defs : languageService.getDefinitionAtPosition(fileName, position);
    },

    getDefinitionAndBoundSpan(fileName, position) {
      const region = regionAt(fileName, position);
      if (region === undefined)
        return languageService.getDefinitionAndBoundSpan(fileName, position);
      return templateService.getDefinitionAndBoundSpan(
        ctx(region, fileName),
        body(region, position),
      );
    },

    getReferencesAtPosition(fileName, position) {
      const region = regionAt(fileName, position);
      if (region === undefined) return languageService.getReferencesAtPosition(fileName, position);
      return (
        templateService.getReferencesAtPosition(ctx(region, fileName), body(region, position)) ??
        languageService.getReferencesAtPosition(fileName, position)
      );
    },

    getSignatureHelpItems(fileName, position, options) {
      const region = regionAt(fileName, position);
      if (region === undefined)
        return languageService.getSignatureHelpItems(fileName, position, options);
      return (
        templateService.getSignatureHelpItemsAtPosition(
          ctx(region, fileName),
          body(region, position),
        ) ?? languageService.getSignatureHelpItems(fileName, position, options)
      );
    },

    getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, preferences) {
      const base = languageService.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      );
      const region = regionAt(fileName, start);
      if (region === undefined) return base;
      const metta = templateService.getCodeFixesAtPosition(
        ctx(region, fileName),
        start - region.contentStart,
        end - region.contentStart,
      );
      return [...base, ...(metta as ts.CodeFixAction[])];
    },

    getOutliningSpans(fileName) {
      const base = languageService.getOutliningSpans(fileName);
      const metta = regionsOf(fileName).flatMap((region) =>
        templateService.getOutliningSpans(ctx(region, fileName)),
      );
      return [...base, ...metta];
    },
  };
}
