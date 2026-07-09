// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The live-introspection provider is interpreter-exact because it runs core's own grounded get-type/get-doc.
// Two guarantees are checked: golden behaviour on ground + adversarial inputs (the type-checking get-type
// returns [] for an ill-typed call, not the declared return type), and a wiring differential asserting the
// provider surfaces exactly what a direct runProgram query does across a broad corpus.

import { format, runProgram } from "@metta-ts/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CoreRuntime } from "../coreRuntime.js";

const runtime = new CoreRuntime();
const FOO = "(: foo (-> Number Number))\n(= (foo $x) (+ $x 1))";
const DOC = `${FOO}\n(@doc foo (@desc "increments") (@params ((@param "the input"))) (@return "one more"))`;

function types(context: string, expression: string): readonly string[] {
  const result = runtime.getType(context, expression);
  if (result.isErr()) throw new Error(`getType errored: ${JSON.stringify(result.error)}`);
  return result.value;
}

// An independent reference: build and run the get-type query directly, the way a user would.
function referenceTypes(context: string, expression: string): string[] {
  const source =
    context.length > 0 ? `${context}\n!(get-type ${expression})` : `!(get-type ${expression})`;
  const last = runProgram(source).at(-1);
  return last ? last.results.map(format) : [];
}

describe("CoreRuntime get-type (golden, interpreter-exact)", () => {
  it("types grounded literals and operators", () => {
    expect(types("", "1")).toStrictEqual(["Number"]);
    expect(types("", '"hi"')).toStrictEqual(["String"]);
    expect(types("", "(+ 1 2)")).toStrictEqual(["Number"]);
    expect(types("", "(< 1 2)")).toStrictEqual(["Bool"]);
    expect(types("", "+")).toStrictEqual(["(-> Number Number Number)"]);
  });

  it("types user definitions in context, including nested calls", () => {
    expect(types(FOO, "foo")).toStrictEqual(["(-> Number Number)"]);
    expect(types(FOO, "(foo 1)")).toStrictEqual(["Number"]);
    expect(types(FOO, "(foo (foo 1))")).toStrictEqual(["Number"]);
  });

  it("returns no type for an ill-typed call (the type checker rejects it)", () => {
    expect(types(FOO, '(foo "x")')).toStrictEqual([]);
  });
});

describe("CoreRuntime get-doc", () => {
  it("parses a @doc-formal record into structured fields", () => {
    const result = runtime.getDoc(DOC, "foo");
    expect(result.isOk()).toBe(true);
    const doc = result._unsafeUnwrap();
    expect(doc).not.toBeNull();
    expect(doc?.item).toBe("foo");
    expect(doc?.kind).toBe("function");
    expect(doc?.type).toBe("(-> Number Number)");
    expect(doc?.description).toBe("increments");
    expect(doc?.params).toStrictEqual([{ type: "Number", description: "the input" }]);
    expect(doc?.return).toStrictEqual({ type: "Number", description: "one more" });
  });

  it("returns null when a symbol has no documentation", () => {
    // A symbol the stdlib never declares or documents; get-doc yields Empty, which parses to null.
    expect(runtime.getDoc("", "no-such-symbol-xyz")._unsafeUnwrap()).toBeNull();
  });
});

describe("CoreRuntime evaluate", () => {
  it("evaluates grounded and user expressions", () => {
    expect(runtime.evaluate("", "(+ 1 2)")._unsafeUnwrap()).toStrictEqual(["3"]);
    expect(runtime.evaluate("(= (foo $x) (+ $x 1))", "(foo 5)")._unsafeUnwrap()).toStrictEqual([
      "6",
    ]);
  });
});

describe("CoreRuntime get-type differential vs a direct runProgram query", () => {
  it("surfaces exactly the interpreter's answer across a corpus of expressions", () => {
    const expressions = [
      "1",
      "3.5",
      '"s"',
      "(+ 1 2)",
      "(* (+ 1 2) 3)",
      "(< 1 2)",
      "(== 1 1)",
      "(if True 1 2)",
      "+",
      "foo",
      "(foo 1)",
      "(foo (foo 2))",
      '(foo "bad")',
      "(foo)",
      "unknownSymbol",
      "(unknownFn 1 2)",
    ];
    expect(() =>
      fc.assert(
        fc.property(fc.constantFrom(...expressions), (expression) => {
          const provider = types(FOO, expression);
          const reference = referenceTypes(FOO, expression);
          return JSON.stringify(provider) === JSON.stringify(reference);
        }),
        { numRuns: expressions.length * 4 },
      ),
    ).not.toThrow();
  });
});
