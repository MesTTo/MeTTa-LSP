// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A throwaway on-disk TypeScript project for the host-bridge tests: a tsconfig, a stubbed `@metta-ts/hyperon`
// so registrar calls resolve to an origin module, and a caller-supplied host source. Writing it to disk (not
// an in-memory VFS) is deliberate — the bridge's `ts.LanguageService` reads through `ts.sys`, exactly as it
// will in a user's workspace, so the fixture exercises real tsconfig + module resolution.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const HYPERON_STUB = `export declare class MeTTa {
  registerOperation(name: string, op: (...args: any[]) => any): void;
  registerAsyncOperation(name: string, op: (...args: any[]) => any): void;
}
export declare function OperationAtom(name: string, op: (...args: any[]) => any, unwrap?: boolean): unknown;
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "Bundler",
    lib: ["ESNext"],
    strict: false,
    noEmit: true,
  },
  include: ["host.ts"],
});

// Create a fresh temp project rooted at a new directory, with `host.ts` holding `hostSource`, and return the
// directory. The caller removes it with `fs.rmSync(dir, { recursive: true, force: true })`.
export function writeBridgeFixture(hostSource: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metta-bridge-"));
  const hyperon = path.join(dir, "node_modules", "@metta-ts", "hyperon");
  fs.mkdirSync(hyperon, { recursive: true });
  fs.writeFileSync(path.join(hyperon, "index.d.ts"), HYPERON_STUB);
  fs.writeFileSync(
    path.join(hyperon, "package.json"),
    JSON.stringify({ name: "@metta-ts/hyperon", version: "1.0.0", types: "index.d.ts" }),
  );
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(path.join(dir, "host.ts"), hostSource);
  return dir;
}
