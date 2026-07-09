import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { evaluatorOptionsForPolicy } from "./guardedEvaluationShared.js";
import { serveNodeWorker } from "./nodeWorkerPort.js";
import { captureOutput, collectResponse, importsAsAtoms } from "./workerShared.js";

async function run(
  request: GuardedEvaluationWorkerRequest,
): Promise<GuardedEvaluationWorkerResponse> {
  // The worker imports core plus @metta-ts/node/source. The source subpath is in-memory only: it adds the
  // Node worker-thread hyperpose hook without loading file-backed import helpers. The effectful bridges
  // (root @metta-ts/node fs helpers, hyperon js-atom bridge, DAS network client, Python bridge) are never
  // referenced here, so their atoms are inert; the safety test pins this file and workerShared to that set.
  const core = await import("@metta-ts/core");
  const node = await import("@metta-ts/node/source");
  // Disable host effects so core's fileio/git-import! grounded ops cannot reach the filesystem or git from the
  // guarded worker. They obtain those host built-ins at runtime via process.getBuiltinModule, which a worker
  // thread would otherwise allow; with the capability off they reduce to inert Error atoms.
  core.setHostEffectsEnabled(false);
  const output = captureOutput(core, request.policy.maxOutputChars);
  try {
    const raw = await node.runSourceAsync(
      request.source,
      new Map(),
      request.policy.fuel,
      importsAsAtoms(core, request.imports),
      {
        ...evaluatorOptionsForPolicy(request.policy),
        parEvalImpl: node.makeParEvalImpl(request.policy.fuel, { hostEffects: false }),
      },
    );
    return collectResponse(core, raw, request.policy, output);
  } finally {
    output.restore();
  }
}

serveNodeWorker(run);
