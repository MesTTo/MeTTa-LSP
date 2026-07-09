// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A `TemplateLanguageService` (for microsoft/typescript-template-language-service-decorator) that answers
// TypeScript-server requests inside a MeTTa `m`/`mAll` tagged template by running the real MeTTa `Analyzer`
// over the template body as a synthetic in-memory document, then converting each LSP-typed result to the
// `ts.*` shape the decorator repositions into the host `.ts` file. It is pure with respect to tsserver: the
// only tsserver contact is `context.toOffset` (position mapping) and `context.node.getSourceFile()` (the host
// file a diagnostic is anchored to), both supplied by the decorator.

import type * as ts from "typescript";
import type { TemplateContext } from "typescript-template-language-service-decorator";
import { Analyzer } from "../server/analyzer.js";
import { InMemoryFileProvider } from "../server/fileProvider.js";
import type { DiagnosticSettings } from "../server/types.js";
import {
  bodyPositionAt,
  lspCodeActionsToTs,
  lspCompletionDetails,
  lspCompletionsToTs,
  lspDefinitionsToTs,
  lspDiagnosticToTs,
  lspHoverToTs,
  lspReferencesToTs,
  lspSignatureHelpToTs,
  lspSymbolsToOutliningSpans,
  METTA_DIAGNOSTIC_CODE,
  rangeToSpan,
  type ToOffset,
} from "./tsConversion.js";

// The tags the eDSL uses for raw MeTTa source: `m` for one atom, `mAll` for several.
export const EMBED_TAGS: readonly string[] = ["m", "mAll"];

export class MettaTemplateService {
  private readonly files = new InMemoryFileProvider("/");
  private readonly analyzer = new Analyzer(this.files);
  private readonly diagnosticsSettings: DiagnosticSettings;
  // Last body loaded per synthetic URI, to skip a redundant re-parse when the template has not changed.
  private readonly loaded = new Map<string, string>();
  private version = 0;

  public constructor(private readonly typescript: typeof ts) {
    this.diagnosticsSettings = this.analyzer.getSettings().diagnostics;
  }

  // Load the template body under a URI unique to this template (many templates share one `.ts` fileName, so
  // the node's start offset disambiguates them). Returns the URI to query.
  private load(context: TemplateContext): string {
    const uri = `metta-embedded:${context.fileName}#${context.node.pos}`;
    if (this.loaded.get(uri) !== context.text) {
      this.version += 1;
      this.analyzer.updateDocument(uri, context.text, this.version, true);
      this.loaded.set(uri, context.text);
    }
    return uri;
  }

  private offsetter(context: TemplateContext): ToOffset {
    return (position) => context.toOffset(position);
  }

  public getSemanticDiagnostics(context: TemplateContext): ts.Diagnostic[] {
    const uri = this.load(context);
    const file = context.node.getSourceFile();
    const toOffset = this.offsetter(context);
    return this.analyzer
      .validate(uri, this.diagnosticsSettings)
      .map((diagnostic) => lspDiagnosticToTs(this.typescript, diagnostic, toOffset, file));
  }

  public getCompletionsAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.WithMetadata<ts.CompletionInfo> {
    const uri = this.load(context);
    return lspCompletionsToTs(
      this.typescript,
      this.analyzer.completions(uri, position),
      this.offsetter(context),
    );
  }

  public getCompletionEntryDetails(
    context: TemplateContext,
    position: ts.LineAndCharacter,
    name: string,
  ): ts.CompletionEntryDetails {
    const uri = this.load(context);
    const item = this.analyzer.completions(uri, position).find((entry) => entry.label === name);
    if (item === undefined)
      return {
        name,
        kind: this.typescript.ScriptElementKind.unknown,
        kindModifiers: "",
        displayParts: [],
        documentation: [],
      };
    return lspCompletionDetails(this.typescript, this.analyzer.resolveCompletion(item));
  }

  public getQuickInfoAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.QuickInfo | undefined {
    const uri = this.load(context);
    return lspHoverToTs(
      this.typescript,
      this.analyzer.hover(uri, position),
      this.offsetter(context),
    );
  }

  public getSignatureHelpItemsAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.SignatureHelpItems | undefined {
    const uri = this.load(context);
    return lspSignatureHelpToTs(this.analyzer.signatureHelp(uri, position), {
      start: 0,
      length: context.text.length,
    });
  }

  public getDefinitionAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.DefinitionInfo[] {
    const uri = this.load(context);
    const locations = this.analyzer
      .definition(uri, position)
      .filter((location) => location.uri === uri);
    return lspDefinitionsToTs(
      this.typescript,
      locations,
      context.fileName,
      this.offsetter(context),
    );
  }

  public getOutliningSpans(context: TemplateContext): ts.OutliningSpan[] {
    const uri = this.load(context);
    return lspSymbolsToOutliningSpans(
      this.typescript,
      this.analyzer.documentSymbols(uri),
      this.offsetter(context),
    );
  }

  public getReferencesAtPosition(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.ReferenceEntry[] | undefined {
    const uri = this.load(context);
    const locations = this.analyzer
      .references(uri, position, true)
      .filter((location) => location.uri === uri);
    if (locations.length === 0) return undefined;
    return lspReferencesToTs(locations, context.fileName, this.offsetter(context));
  }

  public getDefinitionAndBoundSpan(
    context: TemplateContext,
    position: ts.LineAndCharacter,
  ): ts.DefinitionInfoAndBoundSpan {
    const uri = this.load(context);
    const toOffset = this.offsetter(context);
    const definitions = lspDefinitionsToTs(
      this.typescript,
      this.analyzer.definition(uri, position).filter((location) => location.uri === uri),
      context.fileName,
      toOffset,
    );
    // The clicked symbol's own range anchors the bound span; fall back to an empty span at the cursor.
    const target = this.analyzer.prepareRename(uri, position);
    const textSpan =
      target === null
        ? { start: context.toOffset(position), length: 0 }
        : rangeToSpan(target.range, toOffset);
    return { definitions, textSpan };
  }

  public getSupportedCodeFixes(): number[] {
    return [METTA_DIAGNOSTIC_CODE];
  }

  // The decorator also passes the requested error codes and format options; the MeTTa code actions are keyed
  // by range alone, so those trailing arguments are unused and left off (a narrower signature stays assignable
  // to the decorator's `TemplateLanguageService`).
  public getCodeFixesAtPosition(
    context: TemplateContext,
    start: number,
    end: number,
  ): Array<ts.CodeAction | ts.CodeFixAction> {
    const uri = this.load(context);
    const range = {
      start: bodyPositionAt(start, context.text),
      end: bodyPositionAt(end, context.text),
    };
    return lspCodeActionsToTs(
      this.analyzer.codeActions(uri, range),
      uri,
      context.fileName,
      this.offsetter(context),
    );
  }
}
