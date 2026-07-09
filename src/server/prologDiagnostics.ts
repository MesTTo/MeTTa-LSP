// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Host-provided Prolog diagnostics. The analyzer owns where diagnostics appear in MeTTa source; the node
// host owns how a referenced `.pl` file is checked. Browser and in-memory hosts leave this unset.

export interface PrologDiagnosticSettings {
  readonly executable: string;
  readonly timeoutMs: number;
}

export interface PrologSourceDiagnostic {
  readonly line: number;
  readonly character: number;
  readonly severity: number;
  readonly code: string;
  readonly message: string;
}

export interface PrologDiagnosticProvider {
  diagnosticsForFile(
    filePath: string,
    settings: PrologDiagnosticSettings,
  ): readonly PrologSourceDiagnostic[];
  diagnosticsForFileAsync?(
    filePath: string,
    settings: PrologDiagnosticSettings,
    signal?: AbortSignal,
  ): Promise<readonly PrologSourceDiagnostic[]>;
}
