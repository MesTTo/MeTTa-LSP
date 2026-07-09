// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The analysis-side contract for the cross-language grounded-atom bridge. A MeTTa grounded atom is backed
// by a TypeScript host function whose type its own compiler knows; the bridge resolves that host signature
// so the MeTTa surfaces (hover, go-to-definition, diagnostics) can show it at the call site. The analyzer
// depends only on this pure interface and its result types, so it stays browser-safe: the concrete
// `HostTypeService` that owns a `ts.LanguageService` is injected by the node host, never imported here.

import type { Location } from "vscode-languageserver-types";

// One parameter of a host function, carried with both its TypeScript spelling and the MeTTa type its
// grounded value presents as. `rest` marks a `...args` tail; `optional` a `?`-marked or defaulted parameter.
export interface HostParam {
  readonly name: string;
  readonly tsType: string;
  readonly mettaType: string;
  readonly optional: boolean;
  readonly rest: boolean;
}

// A resolved host function signature, rendered for display and reduced to a MeTTa arrow for the type
// cross-check. `label` is the full TypeScript signature text (e.g. `max(...values: number[]): number`).
export interface HostSignature {
  readonly label: string;
  readonly params: readonly HostParam[];
  readonly returnTsType: string;
  readonly returnMettaType: string;
  readonly mettaArrow: string;
  readonly documentation?: string;
}

// How a host binding was reached: a `registerOperation`/`OperationAtom` call site, its async variant, a
// `(js-atom "path")` global resolved on `globalThis`, or a `(js-dot obj "prop")` member access.
export type HostBindingKind = "operation" | "async-operation" | "js-global" | "js-member";

// A MeTTa symbol (or dotted path) bound to a TypeScript host function, with its signature and — when the
// declaration is in the workspace or a lib file — a cross-language definition location.
export interface HostBinding {
  readonly name: string;
  readonly kind: HostBindingKind;
  readonly signature: HostSignature;
  readonly definition?: Location;
  // A short human note on where the binding came from, e.g. `registered in ops.ts` or `lib.es5.d.ts`.
  readonly origin: string;
}

export interface HostBridge {
  // The binding for a MeTTa symbol registered as a grounded operation in the workspace TS, or undefined.
  lookupOperation(name: string): HostBinding | undefined;
  // The binding for a `(js-atom "Dotted.path")` global, resolved by a synthetic TypeScript probe against
  // the ambient lib and workspace types, or undefined when the path does not resolve (or is blocked).
  probeGlobal(dottedPath: string): HostBinding | undefined;
  // Whether a TypeScript project was found to analyse. A false result means the bridge is inert (no
  // tsconfig, no host files, or a host without a filesystem), so callers skip it silently.
  ready(): boolean;
}
