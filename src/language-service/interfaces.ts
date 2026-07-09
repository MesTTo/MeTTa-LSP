import type {
  Diagnostic,
  Hover,
  Location,
  Position,
  Range,
  TextEdit,
} from "vscode-languageserver-types";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export type FileId = number & { readonly __brand: "FileId" };
export type SyntaxEpoch = number & { readonly __brand: "SyntaxEpoch" };
export type AtomspaceEpoch = number & { readonly __brand: "AtomspaceEpoch" };

export interface TextSnapshot {
  readonly uri: string;
  readonly version: number | null;
  readonly text: string;
}

export interface FileProvider {
  readText(uri: string, signal: AbortSignal): Promise<Result<TextSnapshot, FileProviderError>>;
  listWorkspaceFiles(
    rootUri: string,
    signal: AbortSignal,
  ): Promise<Result<readonly string[], FileProviderError>>;
}

export type FileProviderError =
  | { readonly kind: "notFound"; readonly uri: string }
  | { readonly kind: "notReadable"; readonly uri: string; readonly message: string }
  | { readonly kind: "aborted" };

export type RuntimeProviderError =
  | { readonly kind: "policyDenied"; readonly reason: string }
  | { readonly kind: "timeout"; readonly timeoutMs: number }
  | { readonly kind: "unhealthy"; readonly reason: string }
  | { readonly kind: "runtimeError"; readonly message: string };

export interface RuntimeProvider {
  getType(
    source: string,
    range: Range,
    signal: AbortSignal,
  ): Promise<Result<string, RuntimeProviderError>>;
  getDoc(symbol: string, signal: AbortSignal): Promise<Result<string | null, RuntimeProviderError>>;
  evaluate(source: string, signal: AbortSignal): Promise<Result<unknown, RuntimeProviderError>>;
}

export interface AnalysisSnapshot {
  readonly syntaxEpoch: SyntaxEpoch;
  readonly atomspaceEpoch: AtomspaceEpoch;
  diagnostics(uri: string, signal: AbortSignal): Promise<readonly Diagnostic[]>;
  hover(uri: string, position: Position, signal: AbortSignal): Promise<Hover | null>;
  definition(uri: string, position: Position, signal: AbortSignal): Promise<readonly Location[]>;
  references(uri: string, position: Position, signal: AbortSignal): Promise<readonly Location[]>;
  format(uri: string, range: Range | undefined, signal: AbortSignal): Promise<readonly TextEdit[]>;
}

export interface EngineHostLike {
  updateDocument(uri: string, text: string, version: number | null): void;
  closeDocument(uri: string): void;
  snapshot(): AnalysisSnapshot;
}

export function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
