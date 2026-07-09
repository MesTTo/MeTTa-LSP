// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { serveBrowserWorker } from "./browserWorkerPort.js";
import { evaluatorOptionsForPolicy } from "./guardedEvaluationShared.js";
import { captureOutput, collectResponse, importsAsAtoms } from "./workerShared.js";

async function run(
  request: GuardedEvaluationWorkerRequest,
): Promise<GuardedEvaluationWorkerResponse> {
  const core = await import("@metta-ts/core");
  const browser = await import("@metta-ts/browser/source");
  core.setHostEffectsEnabled(false);
  const output = captureOutput(core, request.policy.maxOutputChars);
  try {
    const raw = await browser.runSourceAsync(
      request.source,
      new Map(),
      request.policy.fuel,
      importsAsAtoms(core, request.imports),
      evaluatorOptionsForPolicy(request.policy),
      { hostEffects: false, workerUrl: new URL("./browserHyperposeWorker.js", import.meta.url) },
    );
    return collectResponse(core, raw, request.policy, output);
  } finally {
    output.restore();
  }
}

serveBrowserWorker(run);
