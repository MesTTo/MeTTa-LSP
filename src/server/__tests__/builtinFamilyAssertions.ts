// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0

import { expect } from "vitest";
import { BUILTIN_BY_NAME } from "../builtins.js";

export function expectBuiltinFamilyRegistered(family: readonly string[]): void {
  for (const name of family) {
    const spec = BUILTIN_BY_NAME.get(name);
    expect(spec?.name).toBe(name);
    expect(spec?.kind).toBe("function");
    expect(spec?.signatures.length).toBeGreaterThan(0);
    expect(spec?.documentation.length).toBeGreaterThan(0);
  }
}

export function expectNameSetExact(actual: ReadonlySet<string>, expected: readonly string[]): void {
  expect([...actual].sort()).toStrictEqual([...expected].sort());
}
