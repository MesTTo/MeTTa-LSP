import type { Connection } from "vscode-languageserver";
import type { Analyzer } from "./analyzer.js";
import type { CompletionSettings, HoverSettings } from "./types.js";

interface AnalyzerHandlerOptions {
  readonly hoverSettings?: () => HoverSettings;
  readonly completionSettings?: () => CompletionSettings;
}

export function registerAnalyzerHandlers(
  connection: Connection,
  analyzer: Analyzer,
  options: AnalyzerHandlerOptions = {},
): void {
  connection.onHover((params) =>
    analyzer.hover(params.textDocument.uri, params.position, options.hoverSettings?.()),
  );
  connection.onDefinition((params) =>
    analyzer.definition(params.textDocument.uri, params.position),
  );
  connection.onImplementation((params) =>
    analyzer.implementation(params.textDocument.uri, params.position),
  );
  connection.onReferences((params) =>
    analyzer.references(
      params.textDocument.uri,
      params.position,
      params.context.includeDeclaration,
    ),
  );
  connection.onDocumentSymbol((params) => analyzer.documentSymbols(params.textDocument.uri));
  connection.onWorkspaceSymbol((params) => analyzer.workspaceSymbols(params.query));
  connection.onDocumentFormatting((params) => analyzer.formatDocument(params.textDocument.uri));
  connection.onDocumentRangeFormatting((params) =>
    analyzer.formatRange(params.textDocument.uri, params.range),
  );
  connection.onCompletion((params) =>
    analyzer.completions(params.textDocument.uri, params.position, options.completionSettings?.()),
  );
  connection.onCompletionResolve((item) => analyzer.resolveCompletion(item));
  connection.onSignatureHelp((params) =>
    analyzer.signatureHelp(params.textDocument.uri, params.position),
  );
  connection.onPrepareRename((params) => {
    const prepared = analyzer.prepareRename(params.textDocument.uri, params.position);
    return prepared ? { range: prepared.range, placeholder: prepared.name } : null;
  });
  connection.onRenameRequest((params) =>
    analyzer.rename(params.textDocument.uri, params.position, params.newName),
  );
  connection.languages.semanticTokens.on((params) =>
    analyzer.semanticTokens(params.textDocument.uri),
  );
  connection.languages.foldingRange.on((params) => analyzer.foldingRanges(params.textDocument.uri));
  connection.languages.inlayHint.on((params) =>
    analyzer.inlayHints(params.textDocument.uri, params.range),
  );
  connection.onDocumentHighlight((params) =>
    analyzer.documentHighlights(params.textDocument.uri, params.position),
  );
  connection.onDocumentLinks((params) => analyzer.documentLinks(params.textDocument.uri));
  connection.onSelectionRanges((params) =>
    analyzer.selectionRanges(params.textDocument.uri, params.positions),
  );
  connection.languages.callHierarchy.onPrepare((params) =>
    analyzer.prepareCallHierarchy(params.textDocument.uri, params.position),
  );
  connection.languages.callHierarchy.onIncomingCalls((params) =>
    analyzer
      .incomingCalls(params.item)
      .map((call) => ({ from: call.from, fromRanges: call.fromRanges })),
  );
  connection.languages.callHierarchy.onOutgoingCalls((params) =>
    analyzer
      .outgoingCalls(params.item)
      .map((call) => ({ to: call.to, fromRanges: call.fromRanges })),
  );
}
