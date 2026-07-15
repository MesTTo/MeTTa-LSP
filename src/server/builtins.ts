import { IMPURE_OPS, pettaOpNames } from "@metta-ts/core";
import type { Range } from "vscode-languageserver-types";

import { coreBuiltinTypes } from "../language-service/index.js";
import type { BuiltinSpec, DefinitionKind, DefinitionRecord, TypeSignature } from "./types.js";

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

export const STANDARD_TYPES = new Set([
  "Atom",
  "Symbol",
  "Variable",
  "Expression",
  "Grounded",
  "Type",
  "Bool",
  "True",
  "False",
  "Number",
  "Int",
  "Integer",
  "Float",
  "String",
  "Char",
  "Function",
  "Space",
  "Unit",
  "Nat",
  "List",
  "Error",
  "Undefined",
  "Empty",
  "Any",
  "%Undefined%",
  "%void%",
  "Value",
  "Query",
  "Map",
  "Pair",
  "Maybe",
  "Result",
]);

export const SPECIAL_FORMS = new Set([
  "!",
  "=",
  ":",
  "->",
  "let",
  "let*",
  "match",
  "case",
  "collapse",
  "superpose",
  "unify",
  "if",
  "import!",
  "include",
  "include!",
  "bind!",
  "new-space",
  "add-atom",
  "remove-atom",
  "get-atoms",
  "register-module!",
  "pragma!",
  "eval",
  "quote",
  "unquote",
  "chain",
  "type-cast",
  "car-atom",
  "cdr-atom",
  "cons-atom",
  "empty",
  "function",
  "lambda",
]);

export const OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
  "and",
  "or",
  "not",
  "xor",
]);

// Semantic-token buckets for MeTTa's stdlib vocabulary. These names describe meaning, not colours:
// VS Code themes and user settings decide the final colour through the contributed semantic token types.
export const METTA_CONTROL_FLOW_FORMS = new Set([
  "if",
  "if-error",
  "return-on-error",
  "case",
  "switch",
  "switch-minimal",
  "switch-internal",
  "collapse",
  "collapse-bind",
  "collapse-extract",
  "superpose",
  "superpose-bind",
  "hyperpose",
  "once",
  "empty",
  "par",
  "race",
]);

export const METTA_BINDING_FORMS = new Set([
  "let",
  "let*",
  "chain",
  "function",
  "return",
  "lambda",
]);

export const METTA_PATTERN_FORMS = new Set([
  "match",
  "unify",
  "atom-subst",
  "if-decons-expr",
  "match-types",
  "match-type-or",
  "sealed",
]);

export const METTA_MODULE_FORMS = new Set([
  "import!",
  "include",
  "include!",
  "register-module!",
  "pragma!",
  "module-space-no-deps",
  "mod-space!",
  "print-mods!",
  "git-module!",
  "help!",
  "help-space!",
]);

export const METTA_TYPE_FORMS = new Set([
  ":",
  "->",
  "get-type",
  "get-type-space",
  "get-mettatype",
  "type-cast",
  "type-cast-error-or-bad-type",
  "is-function",
]);

export const METTA_EVALUATION_FORMS = new Set([
  "!",
  "=",
  "eval",
  "evalc",
  "metta",
  "metta-thread",
  "interpret-tuple",
]);

export const METTA_QUOTE_FORMS = new Set(["quote", "unquote", "noeval"]);

export const METTA_ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%"]);
export const METTA_COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!="]);
export const METTA_LOGICAL_OPERATORS = new Set(["and", "or", "not", "xor"]);

export const METTA_MATH_FUNCTIONS = new Set([
  "pow-math",
  "sqrt-math",
  "abs-math",
  "log-math",
  "trunc-math",
  "ceil-math",
  "floor-math",
  "round-math",
  "sin-math",
  "asin-math",
  "cos-math",
  "acos-math",
  "tan-math",
  "atan-math",
  "min-atom",
  "max-atom",
  "sqrt",
  "sin",
  "cos",
  "exp",
  "log",
  "min",
  "max",
]);

export const METTA_COLLECTION_FUNCTIONS = new Set([
  "cons-atom",
  "decons-atom",
  "car-atom",
  "cdr-atom",
  "length",
  "first",
  "last",
  "first-from-pair",
  "second-from-pair",
  "reverse",
  "msort",
  "sort",
  "list_to_set",
  "append",
  "exclude-item",
  "unique",
  "union",
  "intersection",
  "subtraction",
  "map-atom",
  "filter-atom",
  "foldl-atom",
  "for-each-in-atom",
]);

export const METTA_PREDICATE_FUNCTIONS = new Set([
  "is-var",
  "is-ground",
  "is-expr",
  "is-space",
  "is-function",
  "is-member",
  "is-alpha-member",
  "member",
  "noreduce-eq",
  "isnan-math",
  "isinf-math",
]);

export const METTA_ASSERTION_FORMS = new Set([
  "assert",
  "assertIncludes",
  "assertEqual",
  "assertEqualMsg",
  "assertEqualToResult",
  "assertEqualToResultMsg",
  "assertAlphaEqual",
  "assertAlphaEqualMsg",
  "assertAlphaEqualToResult",
  "assertAlphaEqualToResultMsg",
]);

export const METTA_EFFECT_FORMS = new Set([
  "bind!",
  "new-space",
  "new-mork-space",
  "fork-space",
  "context-space",
  "capture",
  "add-atom",
  "remove-atom",
  "get-atoms",
  "add-reduct",
  "add-reducts",
  "add-atoms",
  "new-state",
  "get-state",
  "change-state!",
  "transaction",
  "with-mutex",
  "with_mutex",
  "println!",
  "print!",
  "trace!",
  "format-args",
  "repr",
  "random-int",
  "random-float",
  "current-time",
  "py-atom",
  "py-call",
  "py-eval",
  "py-str",
  "py-import",
  "py-dot",
  "py-list",
  "py-tuple",
  "py-dict",
  "py-chain",
  "prolog-call",
  "prolog-match",
  "Predicate",
  "callPredicate",
  "assertaPredicate",
  "assertzPredicate",
  "retractPredicate",
  "prolog-function",
  "import_prolog_function",
  "prolog-consult",
  "import_prolog_functions_from_file",
]);

// Syntax atoms that @metta-ts/core uses but cannot expose as ordinary typed function declarations.
const CORE_SYNTAX_BUILTINS: BuiltinSpec[] = [
  {
    name: "!",
    kind: "macro",
    arity: { min: 1 },
    signatures: ["(! expression) -> result"],
    documentation:
      "Evaluate a top-level MeTTa query. The language server indexes bang forms but never executes them.",
    insertText: "!($1)",
    source: "@metta-ts/core syntax",
  },
  {
    name: ":",
    kind: "macro",
    arity: 2,
    signatures: ["(: symbol type) -> type-declaration"],
    documentation: "Attach a MeTTa type declaration to a symbol.",
    insertText: "(: ${1:name} (-> ${2:Input} ${3:Output}))",
    source: "@metta-ts/core syntax",
  },
  {
    name: "->",
    kind: "type",
    arity: { min: 1 },
    signatures: ["(-> A B) -> FunctionType", "(-> A B C) -> FunctionType"],
    documentation:
      "Function type constructor. The last argument is the return type; preceding arguments are parameters.",
    source: "@metta-ts/core syntax",
  },
];

// Forms that are valid in the editor but are not currently discoverable from @metta-ts/core's typed builtin
// enumeration. `include!` is an LSP import alias, while `unquote` and `nop` are core prelude rules with docs
// but no `(: name type)` declaration.
const CATALOG_OVERLAY_BUILTINS: BuiltinSpec[] = [
  {
    name: "include!",
    kind: "macro",
    arity: 1,
    signatures: ['(include! "path/to/file.metta") -> Unit'],
    documentation:
      "Include another MeTTa file. Treated as an import alias for language-service visibility.",
    source: "MeTTa LSP import alias",
  },
  {
    name: "unquote",
    kind: "macro",
    arity: 1,
    signatures: ["(unquote expression) -> Atom"],
    documentation: "Unquote a quoted expression in contexts that support it.",
    source: "@metta-ts/core prelude (untyped overlay)",
  },
  {
    name: "nop",
    kind: "function",
    arity: 0,
    signatures: ["(nop) -> Unit"],
    documentation: "No-op placeholder expression.",
    source: "@metta-ts/core prelude (untyped overlay)",
  },
];

// The @metta-ts/py bridge is not part of @metta-ts/core, so coreBuiltinTypes()/pettaOpNames cannot enumerate
// these heads. The unguarded runner wires @metta-ts/py when the source uses one of them, and the catalog keeps
// hover, completion, docs, and undefined-symbol diagnostics aligned with that runtime surface.
const PYTHON_BRIDGE_BUILTINS: BuiltinSpec[] = [
  {
    name: "py-atom",
    kind: "function",
    arity: { min: 1, max: 2 },
    signatures: ["(py-atom path) -> Atom", "(py-atom path Type) -> Atom"],
    documentation:
      "Resolve a dotted Python path to an atom: a value reads as itself (`!(py-atom math.pi)` → `3.141592653589793`) and a callable applies like a function (`!((py-atom operator.add) 40 2)` → `42`). The optional second argument declares the atom's MeTTa type.",
    insertText: "(py-atom ${1:module.name})",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-call",
    kind: "function",
    arity: 1,
    signatures: ["(py-call (fn args...)) -> Atom"],
    documentation:
      "Call Python, dispatching on the head of the argument the way PeTTa does: a bare name is a builtin (`(py-call (str 42))`), a dotted name is a module function (`!(py-call (math.gcd 12 18))` → `6`), and a leading-dot name is a method on a live object.",
    insertText: "(py-call (${1:math.gcd} ${2:12 18}))",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-eval",
    kind: "function",
    arity: 1,
    signatures: ["(py-eval String) -> Atom"],
    documentation: 'Run a Python expression string: `!(py-eval "2 ** 10")` → `1024`.',
    insertText: '(py-eval "${1:2 ** 10}")',
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-str",
    kind: "function",
    arity: 1,
    signatures: ["(py-str Expression) -> String"],
    documentation: "Fold a MeTTa list into one Python string, str()-ing each element.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-import",
    kind: "function",
    arity: 1,
    signatures: ["(py-import module) -> Unit"],
    documentation:
      "Import a Python module by dotted name, or a `.py` file by path, so later py-atom / py-call forms resolve against it.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-dot",
    kind: "function",
    arity: { min: 2, max: 3 },
    signatures: ["(py-dot object attr) -> Atom", "(py-dot object attr Type) -> Atom"],
    documentation:
      "Read an attribute (or bound method) off a live Python handle, getattr-style. The optional third argument declares the result's MeTTa type.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-list",
    kind: "function",
    arity: 1,
    signatures: ["(py-list (items...)) -> Atom"],
    documentation: "Build a Python list from a MeTTa expression's elements.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-tuple",
    kind: "function",
    arity: 1,
    signatures: ["(py-tuple (items...)) -> Atom"],
    documentation: "Build a Python tuple from a MeTTa expression's elements.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-dict",
    kind: "function",
    arity: 1,
    signatures: ["(py-dict ((key value)...)) -> Atom"],
    documentation:
      "Build a Python dict from (key value) pairs; a symbol key becomes a string, other keys marshal as values.",
    source: "@metta-ts/py bridge",
  },
  {
    name: "py-chain",
    kind: "function",
    arity: 1,
    signatures: ["(py-chain (values...)) -> Atom"],
    documentation:
      "Fold the expression's values left to right with Python's `|` operator (operator.or_), Hyperon's py-chain.",
    source: "@metta-ts/py bridge",
  },
];

// The @metta-ts/prolog bridge is a MeTTaLingo host interop package, not a @metta-ts/core builtin. These
// names mirror PROLOG_METTA_SRC plus the grounded operations registered by prologCoreAsyncOps.
const PROLOG_BRIDGE_BUILTINS: BuiltinSpec[] = [
  {
    name: "prolog-call",
    kind: "function",
    arity: 1,
    signatures: ["(prolog-call Atom) -> Atom"],
    documentation:
      "Run a Prolog goal through the configured Prolog bridge and return each solved goal as a MeTTa atom.",
    insertText: "(prolog-call (${1:goal} ${2:$x}))",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-asserta",
    kind: "function",
    arity: 1,
    signatures: ["(prolog-asserta Atom) -> Bool"],
    documentation: "Assert a Prolog predicate at the front of the dynamic database.",
    insertText: "(prolog-asserta (${1:predicate} ${2:arg}))",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-assertz",
    kind: "function",
    arity: 1,
    signatures: ["(prolog-assertz Atom) -> Bool"],
    documentation: "Assert a Prolog predicate at the end of the dynamic database.",
    insertText: "(prolog-assertz (${1:predicate} ${2:arg}))",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-retract",
    kind: "function",
    arity: 1,
    signatures: ["(prolog-retract Atom) -> Bool"],
    documentation:
      "Retract the first matching Prolog predicate and return True when one was removed.",
    insertText: "(prolog-retract (${1:predicate} ${2:arg}))",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-match",
    kind: "function",
    arity: 2,
    signatures: ["(prolog-match Atom Atom) -> Atom"],
    documentation:
      "Run a Prolog goal and project each answer through a MeTTa template, PeTTa-style.",
    insertText: "(prolog-match (${1:goal} ${2:$x}) ${3:$x})",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "Predicate",
    kind: "function",
    arity: 1,
    signatures: ["(Predicate Atom) -> %Undefined%"],
    documentation:
      "Mark a MeTTa expression as a Prolog predicate term for callPredicate-style interop.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "callPredicate",
    kind: "function",
    arity: 1,
    signatures: ["(callPredicate Atom) -> Bool"],
    documentation: "Return True for each Prolog solution of the given predicate goal.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "assertaPredicate",
    kind: "function",
    arity: 1,
    signatures: ["(assertaPredicate Atom) -> Bool"],
    documentation: "Assert a Prolog predicate at the front of the dynamic database.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "assertzPredicate",
    kind: "function",
    arity: 1,
    signatures: ["(assertzPredicate Atom) -> Bool"],
    documentation: "Assert a Prolog predicate at the end of the dynamic database.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "retractPredicate",
    kind: "function",
    arity: 1,
    signatures: ["(retractPredicate Atom) -> Bool"],
    documentation:
      "Retract the first matching Prolog predicate and return True when one was removed.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-function",
    kind: "function",
    arity: 2,
    signatures: ["(prolog-function Atom Expression) -> Atom"],
    documentation:
      "Call an imported Prolog predicate as a MeTTa function, treating the final Prolog argument as the result.",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "import_prolog_function",
    kind: "function",
    arity: 1,
    signatures: ["(import_prolog_function Atom) -> Bool"],
    documentation:
      "Inspect a Prolog predicate's arities and install MeTTa function wrappers for its result argument.",
    insertText: "(import_prolog_function ${1:name})",
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "prolog-consult",
    kind: "function",
    arity: 1,
    signatures: ["(prolog-consult Atom) -> Bool"],
    documentation:
      "Consult a `.pl` file through the Prolog bridge, resolving the path like metta-ts --prolog.",
    insertText: '(prolog-consult "${1:facts.pl}")',
    source: "@metta-ts/prolog bridge",
  },
  {
    name: "import_prolog_functions_from_file",
    kind: "function",
    arity: 2,
    signatures: ["(import_prolog_functions_from_file Atom Expression) -> Bool"],
    documentation:
      "Consult a `.pl` file and install MeTTa wrappers for the named Prolog predicates.",
    insertText: '(import_prolog_functions_from_file "${1:facts.pl}" (${2:predicate}))',
    source: "@metta-ts/prolog bridge",
  },
];

const BUILTIN_OVERLAYS: BuiltinSpec[] = [
  ...CORE_SYNTAX_BUILTINS,
  ...CATALOG_OVERLAY_BUILTINS,
  ...PYTHON_BRIDGE_BUILTINS,
  ...PROLOG_BRIDGE_BUILTINS,
];

// The two facts the interpreter does not expose about a builtin. MACRO_FORMS is which forms the editor
// presents as macros (special evaluation) rather than functions; the interpreter types them all as
// functions. EDITOR_OVERLAY carries snippet completions. Everything else (signature, arity, docs) comes
// from the interpreter.
const MACRO_FORMS = new Set<string>([
  "=",
  "let",
  "let*",
  "case",
  "if",
  "import!",
  "include",
  "register-module!",
  "bind!",
  "pragma!",
  "quote",
  "chain",
]);

const EDITOR_OVERLAY = new Map<string, string>([
  ["=", "(= (${1:name} ${2:$x})\n  ${3:body})"],
  ["let", "(let ${1:$x} ${2:value} ${3:body})"],
  ["let*", "(let* ((${1:$x} ${2:value})) ${3:body})"],
  ["match", "(match ${1:&self} ${2:pattern} ${3:template})"],
  ["case", "(case ${1:expr}\n  (${2:pattern} ${3:body}))"],
  ["import!", '(import! &self "${1:path/to/file.metta}")'],
  ["bind!", "(bind! &${1:space} ${2:(new-space)})"],
]);

// Every name @metta-ts/core declares a type for or registers as a grounded operation. This is the
// enumeration the LSP catalog is built from, so the catalog covers exactly the running system's builtins.
function interpreterBuiltinNames(): Set<string> {
  const names = new Set<string>(coreBuiltinTypes().keys());
  for (const name of pettaOpNames) names.add(name);
  for (const name of IMPURE_OPS) names.add(name);
  // Built-in module exports (json/catalog/fileio) are deliberately absent: they are known only in a file
  // that imports the module, handled by the module-awareness layer, not always-on globals.
  // `check-types` is a grounded op added to core solely to back the LSP's own type/arity diagnostics; it is
  // callable but not a MeTTa language feature, so it is kept out of the catalog (reference, completion, hover).
  for (const name of LSP_INTERNAL_CORE_OPS) names.delete(name);
  return names;
}

// Grounded ops added to core for the LSP's own use, excluded from the user-facing builtin catalog.
export const LSP_INTERNAL_CORE_OPS: ReadonlySet<string> = new Set(["check-types"]);

// The builtin catalog: explicit overlays plus every builtin the interpreter declares, derived at module load
// from @metta-ts/core so it never drifts from the running system. Signature and arity come from the
// interpreter's own `(: name type)` declarations; kind defaults to function and is lifted to macro/type only
// by the sets above; documentation is filled live by get-doc where each surface needs it. Cheap:
// coreBuiltinTypes is atom parsing with no evaluation.
function buildBuiltins(): BuiltinSpec[] {
  const result: BuiltinSpec[] = [...BUILTIN_OVERLAYS];
  const handled = new Set(result.map((builtin) => builtin.name));
  const types = coreBuiltinTypes();
  for (const name of [...interpreterBuiltinNames()].sort()) {
    if (handled.has(name)) continue;
    const declared = types.get(name);
    const kind: DefinitionKind = MACRO_FORMS.has(name)
      ? "macro"
      : STANDARD_TYPES.has(name)
        ? "type"
        : "function";
    result.push({
      name,
      kind,
      arity: declared?.arity ?? undefined,
      signatures: declared ? [declared.type] : [],
      documentation: "",
      insertText: EDITOR_OVERLAY.get(name),
      source: "@metta-ts/core (interpreter-derived)",
    });
  }
  return result;
}

export const BUILTINS: BuiltinSpec[] = buildBuiltins();

// The heads the Python bridge registers. An unguarded run wires the bridge only when the source uses
// one of these, so a plain MeTTa run never pays a Python subprocess.
export const PY_OP_NAMES: ReadonlySet<string> = new Set(
  PYTHON_BRIDGE_BUILTINS.map((builtin) => builtin.name),
);

// The heads the Prolog bridge registers or defines as MeTTa helpers. The LSP keeps these known even when
// @metta-ts/prolog is not installed in the editor extension.
export const PROLOG_OP_NAMES: ReadonlySet<string> = new Set(
  PROLOG_BRIDGE_BUILTINS.map((builtin) => builtin.name),
);

export const BUILTIN_BY_NAME = new Map(BUILTINS.map((builtin) => [builtin.name, builtin] as const));

export function builtinToDefinition(builtin: BuiltinSpec): DefinitionRecord {
  const raw = builtin.signatures[0];
  const signature = raw
    ? (signatureFromCoreType(builtin.name, raw) ?? signatureFromText(builtin.name, raw))
    : undefined;
  return {
    name: builtin.name,
    kind: builtin.kind,
    uri: "metta://stdlib/builtins",
    range: ZERO_RANGE,
    selectionRange: ZERO_RANGE,
    arity: typeof builtin.arity === "number" ? builtin.arity : undefined,
    signature,
    documentation: builtin.documentation,
    detail: builtin.detail ?? builtin.signatures.join("\n"),
    builtin: true,
    deprecated: builtin.deprecated,
    source: builtin.source ?? "@metta-ts/core / MeTTa core forms",
  };
}

// Split a type-argument list on top-level whitespace, keeping a parenthesised group like "(StateMonad $t)"
// intact so a compound type counts as one argument.
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      if (current.length > 0) parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Parse the interpreter's own function type "(-> A B ... R)" into a call signature: params are every type
// but the last, the return is the last. Returns undefined for a non-arrow type (a constant or plain type
// name), so the caller can fall back to the LSP-authored "(name a b) -> ret" form.
export function signatureFromCoreType(name: string, raw: string): TypeSignature | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(->") || !trimmed.endsWith(")")) return undefined;
  const parts = splitTopLevel(trimmed.slice(3, -1).trim());
  if (parts.length === 0) return undefined;
  return {
    name,
    params: parts.slice(0, -1),
    returns: parts[parts.length - 1] ?? "Atom",
    raw: trimmed,
    range: ZERO_RANGE,
    nameRange: ZERO_RANGE,
    uri: "metta://stdlib/builtins",
  };
}

export function signatureFromText(name: string, raw: string): TypeSignature {
  const arrowIndex = raw.lastIndexOf("->");
  const left = arrowIndex >= 0 ? raw.slice(0, arrowIndex).trim() : raw.trim();
  const returns = arrowIndex >= 0 ? raw.slice(arrowIndex + 2).trim() : "Atom";
  const inside = left.replace(/^\(/, "").replace(/\)$/, "").trim();
  const parts = inside.split(/\s+/).filter(Boolean);
  const params = parts[0] === name ? parts.slice(1) : parts;
  return {
    name,
    params,
    returns,
    raw,
    range: ZERO_RANGE,
    nameRange: ZERO_RANGE,
    uri: "metta://stdlib/builtins",
  };
}

export function isBuiltin(name: string): boolean {
  return BUILTIN_BY_NAME.has(name) || STANDARD_TYPES.has(name);
}

export function isKeyword(name: string): boolean {
  return SPECIAL_FORMS.has(name);
}

// The `.metta` suffix makes VS Code render the virtual document with the MeTTa grammar (syntax-highlighted).
const BUILTINS_DOC_URI = "metta://stdlib/builtins.metta";
const TYPES_DOC_URI = "metta://stdlib/types.metta";
const BUILTINS_HEADER =
  "; The MeTTa core forms provided by @metta-ts/core. A generated reference: each form's declaration and\n; its documentation, in catalog order. Read-only — Go to Definition brings you here.";
const TYPES_HEADER =
  "; The standard MeTTa types provided by @metta-ts/core. A generated reference. Read-only.";

// The declaration line shown for a builtin in the generated stdlib reference: a `(: name type)` form built
// from the catalog signature, or `(: name Type)` for a type.
function stdlibDeclaration(def: DefinitionRecord): string {
  if (def.kind === "type") return `(: ${def.name} Type)`;
  if (def.signature)
    return `(: ${def.name} (-> ${[...def.signature.params, def.signature.returns].join(" ")}))`;
  return `(: ${def.name} %Undefined%)`;
}

interface StdlibCache {
  readonly defs: DefinitionRecord[];
  readonly byName: Map<string, DefinitionRecord>;
  readonly text: Map<string, string>;
}
let stdlibCache: StdlibCache | undefined;

// Build the read-only stdlib reference documents once: for each builtin and type, emit its doc comment and a
// declaration, recording the line so the definition points at the declaration, and collect the full text so a
// client content provider can render it.
function generateStdlib(): StdlibCache {
  const defs: DefinitionRecord[] = [];
  const byName = new Map<string, DefinitionRecord>();
  const text = new Map<string, string>();
  const section = (uri: string, header: string, sources: readonly DefinitionRecord[]): void => {
    const lines = [...header.split("\n"), ""];
    for (const base of sources) {
      if (base.documentation)
        for (const docLine of base.documentation.split("\n")) lines.push(`; ${docLine}`);
      const declaration = stdlibDeclaration(base);
      const line = lines.length;
      const nameColumn = Math.max(0, declaration.indexOf(base.name));
      const positioned: DefinitionRecord = {
        ...base,
        uri,
        range: { start: { line, character: 0 }, end: { line, character: declaration.length } },
        selectionRange: {
          start: { line, character: nameColumn },
          end: { line, character: nameColumn + base.name.length },
        },
      };
      defs.push(positioned);
      byName.set(base.name, positioned);
      lines.push(declaration, "");
    }
    text.set(uri, `${lines.join("\n")}\n`);
  };

  section(BUILTINS_DOC_URI, BUILTINS_HEADER, BUILTINS.map(builtinToDefinition));
  const typeDefs: DefinitionRecord[] = [];
  for (const typeName of STANDARD_TYPES) {
    if (BUILTIN_BY_NAME.has(typeName)) continue;
    typeDefs.push({
      name: typeName,
      kind: "type",
      uri: TYPES_DOC_URI,
      range: ZERO_RANGE,
      selectionRange: ZERO_RANGE,
      documentation: `Standard MeTTa type ${typeName}.`,
      detail: "standard type",
      builtin: true,
      source: "@metta-ts/core / MeTTa core types",
    });
  }
  section(TYPES_DOC_URI, TYPES_HEADER, typeDefs);
  return { defs, byName, text };
}

function stdlib(): StdlibCache {
  stdlibCache ??= generateStdlib();
  return stdlibCache;
}

export function allBuiltinDefinitions(): DefinitionRecord[] {
  return stdlib().defs;
}

// The line-accurate definition for a single builtin, so Go to Definition lands on its declaration in the
// generated reference (not at 0,0 like the base builtinToDefinition).
export function builtinDefinition(name: string): DefinitionRecord | undefined {
  return stdlib().byName.get(name);
}

// The text of a generated stdlib reference document (metta://stdlib/…), for the client content provider.
export function stdlibDocumentText(uri: string): string | null {
  return stdlib().text.get(uri) ?? null;
}

export function arityMatches(expected: BuiltinSpec["arity"] | undefined, actual: number): boolean {
  if (expected === undefined) return true;
  if (typeof expected === "number") return actual === expected;
  if (actual < expected.min) return false;
  if (expected.max !== undefined && actual > expected.max) return false;
  return true;
}
