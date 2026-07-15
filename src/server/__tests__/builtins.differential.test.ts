// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The hand-maintained builtins.ts catalog is checked against the interpreter's own type declarations, so a
// fixed-arity builtin can never silently drift from what @metta-ts/core actually declares. Only fully-typed
// fixed-arity entries are compared; variadic and macro/special-form entries (whose static arity is a range
// or whose core type uses %Undefined%/%Undefined%-style variadics) are out of scope for an exact match.

import { describe, expect, it } from "vitest";
import { coreBuiltinTypes } from "../../language-service/index.js";
import { BUILTINS } from "../builtins.js";

const core = coreBuiltinTypes();

describe("builtins.ts catalog vs @metta-ts/core", () => {
  it("core exposes a non-trivial builtin type catalog with correct arities", () => {
    expect(core.size).toBeGreaterThan(50);
    expect(core.get("+")).toStrictEqual({ name: "+", type: "(-> Number Number Number)", arity: 2 });
    expect(core.get("!=")).toStrictEqual({ name: "!=", type: "(-> $t $t Bool)", arity: 2 });
    expect(core.get("not")).toStrictEqual({ name: "not", type: "(-> Bool Bool)", arity: 1 });
  });

  it("no fixed-arity static builtin disagrees with the interpreter's arity", () => {
    const mismatches: string[] = [];
    for (const spec of BUILTINS) {
      const declared = core.get(spec.name);
      if (declared === undefined || declared.arity === null) continue; // core does not type it, or it is a constant
      if (typeof spec.arity !== "number") continue; // variadic static entry: no single arity to compare
      if (declared.type.includes("%Undefined%")) continue; // core's type is variadic/untyped-arg
      if (spec.arity !== declared.arity) {
        mismatches.push(
          `${spec.name}: static arity ${spec.arity} vs core ${declared.arity} (${declared.type})`,
        );
      }
    }
    expect(mismatches).toStrictEqual([]);
  });
});
