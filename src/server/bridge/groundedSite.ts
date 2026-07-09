// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// A host reference embedded in a MeTTa string argument. `@metta-ts/hyperon`'s js interop grounds
// `(js-atom "Dotted.path")` to a global resolved by dotted path and `(js-dot <obj> "prop")` to a member
// access. The cross-language bridge resolves the TypeScript type of that target, so it first needs to know
// which string the cursor is on and what it references. This is pure over the CST: no runtime, no host.

import type { Position, Range } from "vscode-languageserver-types";
import { findNodeAtPosition, nodeTextWithoutQuotes } from "../parser.js";
import { type AstNode, rangeContainsPosition } from "../types.js";

// The head symbols hyperon's `registerJsInterop` grounds. `js-atom` takes the dotted path as its first
// argument; `js-dot` takes the receiver then the property name as its second argument.
const JS_ATOM = "js-atom";
const JS_DOT = "js-dot";

export type GroundedSite =
  | { readonly kind: "js-atom"; readonly path: string; readonly range: Range }
  | {
      readonly kind: "js-dot";
      readonly property: string;
      readonly receiver: AstNode;
      readonly range: Range;
    };

// The grounded host reference the position sits on, or null. Classification is by the enclosing form's head
// and the string argument's position within it, so a cursor on the head symbol or on an unrelated string
// does not resolve.
export function classifyGroundedSite(root: AstNode, position: Position): GroundedSite | null {
  const list = findNodeAtPosition(root, position, (node) => node.kind === "list");
  if (!list) return null;
  const head = list.children[0];
  if (!head || head.kind !== "symbol") return null;
  const stringChild = list.children.find(
    (child) => child.kind === "string" && rangeContainsPosition(child.range, position),
  );
  if (!stringChild) return null;
  const value = nodeTextWithoutQuotes(stringChild);
  if (head.text === JS_ATOM && list.children[1] === stringChild)
    return { kind: "js-atom", path: value, range: stringChild.range };
  if (head.text === JS_DOT && list.children[2] === stringChild) {
    const receiver = list.children[1];
    if (receiver) return { kind: "js-dot", property: value, receiver, range: stringChild.range };
  }
  return null;
}
