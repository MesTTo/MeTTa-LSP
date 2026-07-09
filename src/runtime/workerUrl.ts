// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve a compiled worker beside its caller. Source-driven tests execute from `src/**/*.ts` while the
// worker itself exists only after `tsc` emits `dist/runtime/*.js`, so fall back to that compiled location.
export function resolveRuntimeWorkerUrl(workerFile: string, baseUrl: string): URL {
  const direct = new URL(workerFile, baseUrl);
  if (existsSync(fileURLToPath(direct))) return direct;
  const fileName = workerFile.slice(Math.max(0, workerFile.lastIndexOf("/") + 1));
  const dist = new URL(`../../dist/runtime/${fileName}`, baseUrl);
  return existsSync(fileURLToPath(dist)) ? dist : direct;
}
