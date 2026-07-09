// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The host bridge over a real (temporary) TypeScript project: it indexes `registerOperation`/`OperationAtom`
// /edsl `op` sites to their host signatures, unwraps async ops' Promise return, rejects a same-named method
// from an unrelated module, and resolves `(js-atom "path")` globals against the ambient lib by synthetic
// probe — refusing the paths hyperon itself blocks. The fixture is written to disk so the service exercises
// the real tsconfig + module resolution, exactly as it will in a user's workspace.

import * as fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostTypeService } from "../hostTypeService.js";
import { writeBridgeFixture } from "./fixtureProject.js";

const HOST_TS = `import { MeTTa, OperationAtom } from "@metta-ts/hyperon";

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

const m = new MeTTa();
m.registerOperation("add", add);
m.registerOperation("greet", (name: string, times?: number, ...tags: string[]): string => name);
m.registerAsyncOperation("fetch-count", async (n: number): Promise<number> => n);
OperationAtom("op-atom", add);

// A same-named method from an unrelated class must NOT register as a host operation.
class Registry {
  registerOperation(_name: string, _fn: unknown): void {}
}
new Registry().registerOperation("decoy", add);
`;

let dir: string;
let bridge: HostTypeService;

beforeAll(() => {
  dir = writeBridgeFixture(HOST_TS);
  bridge = new HostTypeService(dir);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("HostTypeService.lookupOperation", () => {
  it("resolves a registerOperation site to the host function's signature and definition", () => {
    const binding = bridge.lookupOperation("add");
    expect(binding).toBeDefined();
    expect(binding?.kind).toBe("operation");
    expect(binding?.signature.params).toEqual([
      { name: "a", tsType: "number", mettaType: "Number", optional: false, rest: false },
      { name: "b", tsType: "number", mettaType: "Number", optional: false, rest: false },
    ]);
    expect(binding?.signature.returnMettaType).toBe("Number");
    expect(binding?.signature.mettaArrow).toBe("(-> Number Number Number)");
    expect(binding?.signature.documentation).toContain("Adds two numbers");
    expect(binding?.definition?.uri.endsWith("host.ts")).toBe(true);
  });

  it("marks optional and rest parameters and maps string to String", () => {
    const params = bridge.lookupOperation("greet")?.signature.params ?? [];
    expect(params[0]).toMatchObject({ name: "name", mettaType: "String" });
    expect(params[1]).toMatchObject({ name: "times", optional: true });
    expect(params[2]).toMatchObject({ name: "tags", rest: true });
  });

  it("unwraps the Promise return of an async operation", () => {
    const binding = bridge.lookupOperation("fetch-count");
    expect(binding?.kind).toBe("async-operation");
    expect(binding?.signature.returnMettaType).toBe("Number");
  });

  it("indexes a bare OperationAtom constructor call", () => {
    expect(bridge.lookupOperation("op-atom")?.kind).toBe("operation");
  });

  it("lists every registered operation for generated docs", () => {
    expect(bridge.registeredOperations().map((binding) => binding.name)).toEqual([
      "add",
      "fetch-count",
      "greet",
      "op-atom",
    ]);
  });

  it("rejects a same-named method from an unrelated module", () => {
    expect(bridge.lookupOperation("decoy")).toBeUndefined();
  });
});

describe("HostTypeService.probeGlobal", () => {
  it("resolves a js-atom dotted path against the ambient lib", () => {
    const binding = bridge.probeGlobal("Math.max");
    expect(binding?.kind).toBe("js-global");
    expect(binding?.signature.returnMettaType).toBe("Number");
    expect(binding?.signature.label).toContain("number");
    expect(binding?.definition?.uri).toContain("lib.");
  });

  it("resolves a nested global predicate", () => {
    const binding = bridge.probeGlobal("Number.isFinite");
    expect(binding?.signature.returnMettaType).toBe("Bool");
  });

  it("refuses a path hyperon blocks", () => {
    expect(bridge.probeGlobal("process.exit")).toBeUndefined();
    expect(bridge.probeGlobal("eval")).toBeUndefined();
  });

  it("returns undefined for a path that does not resolve", () => {
    expect(bridge.probeGlobal("NoSuchGlobal.nope")).toBeUndefined();
  });

  it("reports the service is ready", () => {
    expect(bridge.ready()).toBe(true);
  });
});
