// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The unguarded run's worker. Identical to the guarded evaluationWorker except for requested host
// interops: when the run path saw Python or Prolog heads in the source, it wires the matching MeTTaLingo
// HostInterop and evaluates through core's async runner. The guarded worker never references these packages,
// so guarded evaluation structurally cannot reach Python or Prolog no matter what its policy says. When a
// backend is missing, the run falls back to the available interops or plain core and reports that backend as
// "unavailable" so the client can say why those atoms stayed inert.
//
// Timeout cancellation first disposes the composed host interop, which exits backend child processes. The
// parent still force-terminates the worker if cleanup does not acknowledge within its grace period.

import type { Atom, ReduceResult } from "@metta-ts/core";
import type { HostInterop } from "@metta-ts/core/host";
import type { PythoniaLike } from "@metta-ts/py/pythonia";
import type {
  GuardedEvaluationWorkerRequest,
  GuardedEvaluationWorkerResponse,
} from "../server/guardedEvaluationTypes.js";
import { serveNodeWorker } from "./nodeWorkerPort.js";
import {
  captureOutput,
  collectResponse,
  importsAsAtoms,
  type OutputCapture,
} from "./workerShared.js";

interface PyModules {
  readonly py: typeof import("@metta-ts/py");
  readonly pyBackend: typeof import("@metta-ts/py/pythonia");
  readonly python: PythoniaLike;
}

interface PrologModules {
  readonly prolog: typeof import("@metta-ts/prolog");
  readonly swi: typeof import("@metta-ts/prolog/swi-node");
}

let cancellationRequested = false;
let cancelActiveRun: (() => Promise<void>) | null = null;

function cancellationError(): Error {
  return new Error("Evaluation cancelled.");
}

async function loadPython(): Promise<PyModules | null> {
  try {
    const { python } = await import("pythonia");
    const py = await import("@metta-ts/py");
    const pyBackend = await import("@metta-ts/py/pythonia");
    return { py, pyBackend, python };
  } catch {
    return null;
  }
}

async function loadProlog(): Promise<PrologModules | null> {
  try {
    const prolog = await import("@metta-ts/prolog");
    const swi = await import("@metta-ts/prolog/swi-node");
    return { prolog, swi };
  } catch {
    return null;
  }
}

function importName(atom: Atom | undefined): string | undefined {
  if (atom?.kind === "sym") return atom.name;
  if (atom?.kind === "gnd" && atom.value.g === "str") return atom.value.s;
  if (
    atom?.kind === "expr" &&
    atom.items.length === 2 &&
    atom.items[0]?.kind === "sym" &&
    atom.items[0].name === "library"
  )
    return importName(atom.items[1]);
  return undefined;
}

function resolveImportPath(importPaths: Readonly<Record<string, string>>, name: string): string {
  return importPaths[name] ?? importPaths[JSON.stringify(name)] ?? name;
}

function messageFrom(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

function hostImportForExtension(
  core: typeof import("@metta-ts/core"),
  extension: string,
  load: (name: string) => Promise<void>,
): HostInterop["hostImport"] {
  return async (_space, target): Promise<ReduceResult> => {
    const name = importName(target);
    if (name === undefined || !name.endsWith(extension)) return { tag: "noReduce" };
    try {
      await load(name);
      return { tag: "ok", results: [core.emptyExpr] };
    } catch (error) {
      return { tag: "runtimeError", msg: `import!: ${name}: ${messageFrom(error)}` };
    }
  };
}

async function createPythonInterop(
  core: typeof import("@metta-ts/core"),
  importPaths: Readonly<Record<string, string>>,
): Promise<HostInterop | null> {
  const modules = await loadPython();
  if (modules === null) return null;
  const bridge = modules.pyBackend.pythoniaBridge(modules.python);
  return {
    name: "pythonia",
    prelude: modules.py.PY_METTA_SRC,
    asyncOps: modules.py.pyCoreAsyncOps(bridge),
    hostImport: hostImportForExtension(core, ".py", (name) =>
      bridge.import(resolveImportPath(importPaths, name)),
    ),
    dispose: () => bridge.dispose(),
  };
}

async function createPrologInterop(
  core: typeof import("@metta-ts/core"),
  importPaths: Readonly<Record<string, string>>,
): Promise<HostInterop | null> {
  const modules = await loadProlog();
  if (modules === null) return null;
  const bridge = modules.swi.swiPrologBridge();
  const resolvePath = (name: string): string => resolveImportPath(importPaths, name);
  return {
    name: "swi-prolog",
    prelude: modules.prolog.PROLOG_METTA_SRC,
    asyncOps: modules.prolog.prologCoreAsyncOps(bridge, { resolvePath }),
    hostImport: hostImportForExtension(core, ".pl", (name) => bridge.consult(resolvePath(name))),
    dispose: () => bridge.dispose(),
  };
}

async function run(
  request: GuardedEvaluationWorkerRequest,
): Promise<GuardedEvaluationWorkerResponse> {
  let host: HostInterop | null = null;
  const interops: HostInterop[] = [];
  let disposePromise: Promise<void> | null = null;
  let output: OutputCapture | undefined;
  let finishRun: (() => void) | undefined;
  const runFinished = new Promise<void>((resolve) => {
    finishRun = resolve;
  });
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      if (host !== null) {
        await host.dispose?.();
        return;
      }
      await Promise.all(interops.map(async (interop) => interop.dispose?.()));
    })();
    return disposePromise;
  };
  const addInterop = async (interop: HostInterop | null): Promise<boolean> => {
    if (cancellationRequested) {
      await interop?.dispose?.();
      throw cancellationError();
    }
    if (interop === null) return false;
    interops.push(interop);
    return true;
  };
  cancelActiveRun = async () => {
    try {
      await dispose();
    } finally {
      // Interop construction can still be in flight when cancellation arrives. Its cancellation check
      // disposes the newly created interop before the run settles.
      await runFinished;
    }
  };
  try {
    const core = await import("@metta-ts/core");
    const hostApi = await import("@metta-ts/core/host");
    const node = await import("@metta-ts/node/source");
    if (cancellationRequested) throw cancellationError();
    output = captureOutput(core, request.policy.maxOutputChars);
    const imports = importsAsAtoms(core, request.imports);
    const options = {
      tabling: request.policy.tabling,
      maxStackDepth: request.policy.maxStackDepth,
      experimental: request.policy.experimental,
    };
    let python: GuardedEvaluationWorkerResponse["python"];
    let prolog: GuardedEvaluationWorkerResponse["prolog"];
    if (request.python === true) {
      const interop = await createPythonInterop(core, request.importPaths ?? {});
      python = (await addInterop(interop)) ? "live" : "unavailable";
    }
    if (request.prolog === true) {
      const interop = await createPrologInterop(core, request.importPaths ?? {});
      prolog = (await addInterop(interop)) ? "live" : "unavailable";
    }
    host = hostApi.composeHostInterops(interops);
    const source =
      host.prelude === undefined ? request.source : `${host.prelude}\n${request.source}`;
    const raw = await node.runSourceAsync(
      source,
      new Map(host.asyncOps ?? []),
      request.policy.fuel,
      imports,
      {
        ...options,
        ...(host.hostImport !== undefined ? { hostImport: host.hostImport } : {}),
      },
    );
    return {
      ...collectResponse(core, raw, request.policy, output),
      ...(python !== undefined ? { python } : {}),
      ...(prolog !== undefined ? { prolog } : {}),
    };
  } finally {
    try {
      await dispose();
    } finally {
      output?.restore();
      finishRun?.();
      cancelActiveRun = null;
    }
  }
}

serveNodeWorker(run, {
  cancel: async () => {
    cancellationRequested = true;
    await cancelActiveRun?.();
  },
});
