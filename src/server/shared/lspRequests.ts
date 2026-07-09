import type { Range } from "vscode-languageserver-types";

import type {
  GuardedEvaluationPolicy,
  GuardedEvaluationResult,
} from "../guardedEvaluationTypes.js";

export const IndexStatsRequest = "metta/indexStats";
export const SideEffectPolicyRequest = "metta/sideEffectPolicy";
export const GuardedEvaluationRequest = "metta/evaluateGuarded";
export const TraceRequest = "metta/trace";
export const LspToolRequest = "metta/lspTool";
export const CapabilityRegistryRequest = "metta/capabilities";
export const RuntimeCapabilitiesRequest = "metta/runtime/capabilities";
export const FsReadFileRequest = "metta/fs/readFile";
export const FsListFilesRequest = "metta/fs/listFiles";
export const FsWatchPatternRequest = "metta/fs/watchPattern";

export interface IndexStatsResult {
  readonly files: number;
  readonly openDocuments: number;
  readonly symbols: number;
  readonly definitions: number;
  readonly imports: number;
  readonly diagnosticsCacheEntries: number;
  readonly workspaceRoots: readonly string[];
}

export interface SideEffectPolicyResult {
  readonly sideEffectFree: false;
  readonly guardedEvaluation: true;
  readonly analysisOperationsAreReadOnly: true;
  readonly evaluationRequiresExplicitRequest: true;
  readonly note: string;
  readonly defaultGuard: GuardedEvaluationPolicy;
}

export interface GuardedEvaluationParams {
  readonly uri?: string;
  readonly source?: string;
  readonly range?: Range;
  readonly includePriorDefinitions?: boolean;
  readonly policy?: Partial<GuardedEvaluationPolicy>;
  readonly wrapBareExpression?: boolean;
}

export type GuardedEvaluationResultPayload = GuardedEvaluationResult;

export interface TraceParams {
  readonly uri: string;
  readonly range?: Range;
  readonly query?: string;
  readonly maxSteps?: number;
}

export interface TraceResultPayload {
  readonly ok: boolean;
  readonly query: string;
  readonly steps: readonly (readonly string[])[];
  readonly final: readonly string[];
  readonly truncated: boolean;
  readonly error?: string;
}

export interface CapabilityRegistryResult {
  readonly total: number;
  readonly stable: number;
  readonly preview: number;
  readonly experimental: number;
  readonly runtime: number;
  readonly surfaces: Record<string, number>;
}

export interface FsFileSnapshot {
  readonly uri: string;
  readonly text: string;
}

export interface FsReadFileParams {
  readonly uri: string;
}

export interface FsReadFileResult {
  readonly uri: string;
  readonly text: string | null;
}

export interface FsListFilesParams {
  readonly roots: readonly string[];
  readonly extensions: readonly string[];
  readonly exclude: readonly string[];
  readonly maxFiles: number;
}

export interface FsListFilesResult {
  readonly files: readonly FsFileSnapshot[];
  readonly truncated: boolean;
}

export interface FsWatchPatternParams {
  readonly glob: string;
}

export interface FsWatchPatternResult {
  readonly watching: boolean;
}
