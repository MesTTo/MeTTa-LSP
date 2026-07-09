// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type {
  GuardedEvaluationRequest,
  GuardedEvaluationResult,
} from "../server/guardedEvaluationTypes.js";
import type {
  SemanticLintWorkerRequest,
  SemanticLintWorkerResponse,
} from "./semanticLintShared.js";

export interface RuntimeCapabilities {
  readonly host: "node" | "browser" | "inline-test";
  readonly guardedEvaluation: boolean;
  readonly unguardedEvaluation: boolean;
  readonly semanticLintWorker: boolean;
  readonly nodeWorkers: boolean;
  readonly webWorkers: boolean;
  readonly hyperposeWorkers: boolean;
  readonly python: boolean;
  readonly prolog: boolean;
  readonly filesystem: boolean;
}

export interface RuntimeHost {
  readonly capabilities: RuntimeCapabilities;
  guardedEvaluate(request: GuardedEvaluationRequest): Promise<GuardedEvaluationResult>;
  semanticLint?(request: SemanticLintWorkerRequest): Promise<SemanticLintWorkerResponse>;
}

export const NODE_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  host: "node",
  guardedEvaluation: true,
  unguardedEvaluation: true,
  semanticLintWorker: true,
  nodeWorkers: true,
  webWorkers: false,
  hyperposeWorkers: true,
  python: true,
  prolog: true,
  filesystem: true,
};

export const BROWSER_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  host: "browser",
  guardedEvaluation: true,
  unguardedEvaluation: false,
  semanticLintWorker: true,
  nodeWorkers: false,
  webWorkers: typeof Worker !== "undefined",
  hyperposeWorkers: typeof Worker !== "undefined",
  python: false,
  prolog: false,
  filesystem: false,
};
