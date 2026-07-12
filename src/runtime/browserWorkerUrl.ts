// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

// Preserve the owning worker's build query when it starts a nested worker, so one page load cannot mix
// worker bundles from different deployments.
export function relatedBrowserWorkerUrl(relativePath: string, ownerUrl = import.meta.url): URL {
  const owner = new URL(ownerUrl);
  const worker = new URL(relativePath, owner);
  worker.search = owner.search;
  return worker;
}
