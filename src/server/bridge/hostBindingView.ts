// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Presentation of a resolved host binding, shared by every surface that shows it (the LSP hover, and the MCP
// tool). Pure: it turns a `HostBinding` into markdown lines and a one-line summary, with no host access, so
// the browser-safe analyzer can consume it directly.

import type { HostBinding } from "./hostBridge.js";

const FENCE = "```";

function fence(language: string, code: string): string {
  return `${FENCE}${language}\n${code}\n${FENCE}`;
}

// The markdown block for a host binding, as lines the caller joins with blank lines. Shows the TypeScript
// signature, the MeTTa type it maps to, any host documentation, and where the host code lives.
export function hostBindingHoverLines(binding: HostBinding): string[] {
  const lines = [
    `**Host (TypeScript)** · \`${binding.kind}\``,
    fence("typescript", `${binding.name}${binding.signature.label}`),
    fence("metta", `(: ${binding.name} ${binding.signature.mettaArrow})`),
  ];
  if (binding.signature.documentation !== undefined) lines.push(binding.signature.documentation);
  lines.push(`_Host source: ${binding.origin}_`);
  return lines;
}

// A single-line summary of a host binding, for compact surfaces (completion detail, log lines).
export function hostBindingSummary(binding: HostBinding): string {
  return `${binding.name}${binding.signature.label} — ${binding.signature.mettaArrow}`;
}
