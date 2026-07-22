// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The concrete host bridge: it owns a `ts.LanguageService` over the user's TypeScript project and answers
// two questions the MeTTa surfaces ask. `lookupOperation(name)` finds where a MeTTa symbol was bound to a TS
// function — `m.registerOperation("name", fn)`, `OperationAtom("name", fn)`, or the edsl `db.op("name", fn)`
// — and reads that function's signature/docs/definition through the checker. `probeGlobal(path)` resolves a
// `(js-atom "Dotted.path")` reference by injecting a synthetic probe file and reading the type at it. The
// TS-mechanics (overlay host, call-site walk, signature serialisation, synthetic probe) are the patterns
// verified against a fixture project; here they are mapped onto the pure `HostBinding` result types and the
// TS→MeTTa type table.

import * as nodePath from "node:path";
import * as ts from "typescript";
import type { Location, Position } from "vscode-languageserver-types";
import { pathToUri } from "../../language-service/index.js";
import type {
  HostBinding,
  HostBindingKind,
  HostBridge,
  HostParam,
  HostSignature,
} from "./hostBridge.js";
import { createHostService, type HostServiceBundle } from "./overlayHost.js";
import { mettaArrowType, tsTypeToMetta } from "./typeTable.js";

// The path segments hyperon's `jsToAtom`/`resolvePath` refuses (BLOCKED_SEGMENTS). Resolving them would name
// a global the runtime never exposes, so a probe for a blocked path resolves to nothing.
const BLOCKED_SEGMENTS = new Set([
  "eval",
  "Function",
  "constructor",
  "prototype",
  "__proto__",
  "process",
  "require",
  "Reflect",
  "globalThis",
  "global",
  "module",
  "import",
  "child_process",
]);

// The registrar shapes the indexer recognises: method calls on a MeTTa/edsl instance, plus the standalone
// `OperationAtom` constructor. The async variants bind a function whose awaited result is the MeTTa value.
const OP_METHODS = new Set(["registerOperation", "registerAsyncOperation", "op", "asyncOp"]);
const ASYNC_OP_METHODS = new Set(["registerAsyncOperation", "asyncOp"]);
const OP_IDENTIFIERS = new Set(["OperationAtom"]);
// The rebrand publishes the engine under the canonical `@mettascript/*` scope and keeps `@metta-ts/*` as
// re-export shims, so a `registerOperation` callee imported from either scope resolves to a declaration
// under `@mettascript/*`. Both scopes are listed so the origin check accepts host bridges written against
// either one.
const ORIGIN_MODULES = [
  "@mettascript/hyperon",
  "@mettascript/edsl",
  "@metta-ts/hyperon",
  "@metta-ts/edsl",
];

const PROBE_FILE = "__metta_probe__.ts";
const PROMISE_WRAPPER = /^Promise<(.+)>$/;

interface OpSite {
  readonly name: string;
  readonly fnArg: ts.Node | undefined;
  readonly callee: ts.Node;
  readonly async: boolean;
}

function isSafePath(path: string): boolean {
  if (path.length === 0) return false;
  return path.split(".").every((segment) => segment.length > 0 && !BLOCKED_SEGMENTS.has(segment));
}

// The deepest node covering an offset, mirroring graphqlsp's `findNode`: descend while the offset is inside
// the node, returning the innermost. A probe lands on the last character of the target expression, so this
// returns its final identifier.
function nodeAtOffset(source: ts.SourceFile, offset: number): ts.Node | undefined {
  const find = (node: ts.Node): ts.Node | undefined => {
    if (offset >= node.getStart(source) && offset < node.getEnd())
      return ts.forEachChild(node, find) ?? node;
    return undefined;
  };
  return find(source);
}

function unwrapPromise(tsType: string): string {
  const match = PROMISE_WRAPPER.exec(tsType.trim());
  return match?.[1] ?? tsType;
}

function basenameOfUri(uri: string): string {
  return uri.slice(uri.lastIndexOf("/") + 1);
}

// A call site whose callee names a registrar with a string-literal first argument, or null. The origin is
// confirmed separately so a same-named unrelated method does not register.
function matchOpSite(node: ts.Node): OpSite | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  let ok = false;
  let async = false;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.name) &&
    OP_METHODS.has(callee.name.text)
  ) {
    ok = true;
    async = ASYNC_OP_METHODS.has(callee.name.text);
  } else if (ts.isIdentifier(callee) && OP_IDENTIFIERS.has(callee.text)) {
    ok = true;
  }
  const first = node.arguments[0];
  if (!ok || !first || !ts.isStringLiteralLike(first)) return null;
  return { name: first.text, fnArg: node.arguments[1], callee, async };
}

// Whether the callee resolves to a declaration in one of the ORIGIN_MODULES (the engine's hyperon/edsl
// packages, either scope). An import alias is followed to its real declaration; an unresolvable callee
// (untyped JS, missing types) falls back to acceptance by name, while a callee that resolves to some OTHER
// module is rejected.
function originConfirmed(checker: ts.TypeChecker, callee: ts.Node): boolean {
  const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let symbol = checker.getSymbolAtLocation(nameNode);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
    symbol = checker.getAliasedSymbol(symbol);
  const declarations = symbol?.getDeclarations();
  if (!declarations || declarations.length === 0) return true;
  return declarations.some((declaration) =>
    ORIGIN_MODULES.some((module) => declaration.getSourceFile().fileName.includes(module)),
  );
}

export class HostTypeService implements HostBridge {
  private bundle: HostServiceBundle | null = null;
  private probePath = "";
  private opIndex: Map<string, HostBinding> | null = null;
  private opFingerprint = "";

  public constructor(private readonly workspaceRoot: string) {}

  // The language service is built on first use, not at construction, so injecting the bridge costs nothing
  // until a grounded-atom hover or definition actually reaches into the host.
  private ensure(): HostServiceBundle {
    if (!this.bundle) {
      this.bundle = createHostService(this.workspaceRoot);
      this.probePath = nodePath.resolve(this.bundle.host.getCurrentDirectory(), PROBE_FILE);
    }
    return this.bundle;
  }

  public ready(): boolean {
    return this.ensure().service.getProgram() !== undefined;
  }

  public lookupOperation(name: string): HostBinding | undefined {
    return this.operationIndex().get(name);
  }

  // Every registered grounded operation the TypeScript project exposes. Hovers resolve a single name; the
  // docs generator uses the same index to publish one host-operation page per binding.
  public registeredOperations(): readonly HostBinding[] {
    return [...this.operationIndex().values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  public probeGlobal(dottedPath: string): HostBinding | undefined {
    if (!isSafePath(dottedPath)) return undefined;
    const { service, host } = this.ensure();
    const wrapped = `;(${dottedPath});\n`;
    host.setOverlay(this.probePath, wrapped);
    const program = service.getProgram();
    const source = program?.getSourceFile(this.probePath);
    if (!program || !source) return undefined;
    const checker = program.getTypeChecker();
    // Land inside the final identifier of the expression so a member access resolves to its property.
    const offset = wrapped.indexOf(dottedPath) + dottedPath.length - 1;
    const node = nodeAtOffset(source, offset);
    if (!node) return undefined;
    const signature = this.serialize(checker, node, false);
    if (!signature) return undefined;
    const definition = this.defLocationOf(checker, node);
    return {
      name: dottedPath,
      kind: "js-global",
      signature,
      definition,
      origin: definition ? basenameOfUri(definition.uri) : "globalThis",
    };
  }

  private operationIndex(): Map<string, HostBinding> {
    const { service, host } = this.ensure();
    const program = service.getProgram();
    if (!program) return this.opIndex ?? new Map<string, HostBinding>();
    // Fingerprint the non-probe files: a `probeGlobal` overlay bumps the program but leaves these unchanged,
    // so js-atom hovers never trigger a full re-walk of the workspace.
    const fingerprint = host
      .getScriptFileNames()
      .filter((file) => file !== this.probePath)
      .map((file) => `${file}@${host.getScriptVersion(file)}`)
      .join(";");
    if (this.opIndex && fingerprint === this.opFingerprint) return this.opIndex;
    this.opFingerprint = fingerprint;
    this.opIndex = this.buildOperationIndex(program);
    return this.opIndex;
  }

  private buildOperationIndex(program: ts.Program): Map<string, HostBinding> {
    const checker = program.getTypeChecker();
    const index = new Map<string, HostBinding>();
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile || source.fileName.includes("/node_modules/")) continue;
      if (source.fileName === this.probePath) continue;
      const visit = (node: ts.Node): void => {
        const site = matchOpSite(node);
        if (site && originConfirmed(checker, site.callee)) {
          const binding = this.bindingForSite(checker, site);
          if (binding) index.set(binding.name, binding);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    return index;
  }

  private bindingForSite(checker: ts.TypeChecker, site: OpSite): HostBinding | undefined {
    if (!site.fnArg) return undefined;
    const signature = this.serialize(checker, site.fnArg, site.async);
    if (!signature) return undefined;
    const definition = this.defLocationOf(checker, site.fnArg);
    const kind: HostBindingKind = site.async ? "async-operation" : "operation";
    return {
      name: site.name,
      kind,
      signature,
      definition,
      origin: definition ? basenameOfUri(definition.uri) : "registered",
    };
  }

  private serialize(
    checker: ts.TypeChecker,
    node: ts.Node,
    async: boolean,
  ): HostSignature | undefined {
    const signature = checker.getTypeAtLocation(node).getCallSignatures()[0];
    if (!signature) return undefined;
    const params: HostParam[] = signature.getParameters().map((parameter): HostParam => {
      const declaration = parameter.valueDeclaration;
      const paramDecl =
        declaration !== undefined && ts.isParameter(declaration) ? declaration : undefined;
      const rest = paramDecl?.dotDotDotToken !== undefined;
      const optional =
        (paramDecl !== undefined && checker.isOptionalParameter(paramDecl)) ||
        (parameter.flags & ts.SymbolFlags.Optional) !== 0;
      const tsType = checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, node));
      return {
        name: parameter.getName(),
        tsType,
        mettaType: tsTypeToMetta(tsType),
        optional,
        rest,
      };
    });
    const returnTsType = checker.typeToString(signature.getReturnType());
    const returnMettaType = tsTypeToMetta(async ? unwrapPromise(returnTsType) : returnTsType);
    const rendered = params
      .map((p) => `${p.rest ? "..." : ""}${p.name}${p.optional && !p.rest ? "?" : ""}: ${p.tsType}`)
      .join(", ");
    const documentation = ts.displayPartsToString(signature.getDocumentationComment(checker));
    return {
      label: `(${rendered}): ${returnTsType}`,
      params,
      returnTsType,
      returnMettaType,
      mettaArrow: mettaArrowType(
        params.map((p) => p.mettaType),
        returnMettaType,
      ),
      documentation: documentation.length > 0 ? documentation : undefined,
    };
  }

  private defLocationOf(checker: ts.TypeChecker, node: ts.Node): Location | undefined {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0)
      symbol = checker.getAliasedSymbol(symbol);
    const declaration =
      symbol?.valueDeclaration ??
      symbol?.getDeclarations()?.[0] ??
      (ts.isFunctionLike(node) ? node : undefined);
    if (!declaration) return undefined;
    const target = ts.getNameOfDeclaration(declaration) ?? declaration;
    const source = target.getSourceFile();
    const start: Position = ts.getLineAndCharacterOfPosition(source, target.getStart(source));
    const end: Position = ts.getLineAndCharacterOfPosition(source, target.getEnd());
    return { uri: pathToUri(source.fileName), range: { start, end } };
  }
}
