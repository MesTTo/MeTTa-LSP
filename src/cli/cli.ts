#!/usr/bin/env node
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultMettaDocsOptions,
  generateMettaDocs,
  parseRootList,
} from "../docs/mettaDocsGenerator.js";
import { MettaDoc } from "../dsl/index.js";
import {
  classifyTestQueries,
  pathToUri,
  structuralReplace,
  structuralSearch,
  summarize,
  toJUnitXml,
} from "../language-service/index.js";
import { evaluateGuarded, evaluateUnguarded } from "../runtime/guardedEvaluation.js";
import { NodeFileProvider } from "../runtime/nodeFileProvider.js";
import { traceReduction } from "../runtime/trace.js";
import { framesToHtml, reductionFrames } from "../runtime/visualise.js";
import { Analyzer } from "../server/analyzer.js";
import { HostTypeService } from "../server/bridge/hostTypeService.js";
import { CAPABILITIES, CAPABILITY_IDS, capabilitySummary } from "../server/capabilities.js";
import { NodePrologDiagnosticProvider } from "../server/nodePrologDiagnostics.js";
import { flagValue, positionalArgs } from "./args.js";
import { startRepl } from "./repl.js";
import {
  inspectStdlib,
  renderStdlibError,
  renderStdlibInspection,
  renderStdlibList,
  stdlibCatalog,
} from "./stdlib.js";

// Listing the whole stdlib is commonly piped into a pager or head. Treat a closed downstream pipe as normal
// termination instead of printing an uncaught EPIPE stack trace.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const HELP = `metta-lsp <command> [args]\n\nCommands:\n  capabilities\n  list stdlib [--json]\n  inspect <name> [--json]\n  check <file> [--json] [--show-suppressed]\n  symbols <file> [--json]\n  hover <file> <line> <character> [--json]\n  def <file> <line> <character> [--json]\n  host-type <file> <line> <character> [--json]\n  explain <file> <line> <character> [--json]\n  refs <file> <line> <character> [--json]\n  fmt <file> [--check]\n  lint <file> [--json] [--fix]\n  search <file> "<pattern>" [--json]\n  replace <file> "<pattern>" "<template>" [--write]\n  test <file> [--json] [--tap] [--junit]\n  run <file> [--unguarded]\n  trace <file> "<query>" [--json] [--max N]\n  visualise <file> "<query>" [--out file.html] [--block]\n  doc [workspace] [--json] [--build] [--serve] [--open] [--port N] [--base PATH]\n      [--module-roots PATHS] [--host-roots PATHS]\n  repl [file]\n  lsp --stdio\n  mcp --stdio\n\nMost commands take --json for machine-readable output.`;

function usage(): never {
  console.error(HELP);
  process.exit(2);
}

// 1-based line and column of a source offset, for semgrep-style lint output.
function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") {
      line += 1;
      col = 1;
    } else col += 1;
  }
  return { line, col };
}

function asPosition(line?: string, character?: string) {
  return {
    line: Math.max(0, Number(line ?? "1") - 1),
    character: Math.max(0, Number(character ?? "1") - 1),
  };
}

function makeAnalyzer(file?: string) {
  const resolvedFile = file === undefined ? undefined : path.resolve(file);
  const root = resolvedFile === undefined ? process.cwd() : path.dirname(resolvedFile);
  // The host bridge builds its TypeScript service lazily, so injecting it costs nothing on commands (fmt,
  // lint) that never reach a grounded-atom hover or definition.
  const analyzer = new Analyzer(
    new NodeFileProvider(),
    undefined,
    new HostTypeService(root),
    new NodePrologDiagnosticProvider(),
  );
  analyzer.setWorkspaceRoots([pathToUri(root)]);
  if (resolvedFile !== undefined)
    analyzer.updateDocument(
      pathToUri(resolvedFile),
      fs.readFileSync(resolvedFile, "utf8"),
      null,
      true,
    );
  return analyzer;
}

function print(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function cliPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function findDocsRepoRoot(start: string): string | null {
  let current = path.resolve(start);
  for (;;) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "docs-site/package.json"))
    )
      return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function docsRepoRoot(): string {
  const root = findDocsRepoRoot(process.cwd()) ?? findDocsRepoRoot(cliPackageRoot());
  if (root === null || !fs.existsSync(path.join(root, "docs-site/package.json")))
    throw new Error("metta-lsp doc must run from a checkout with docs-site/package.json");
  return root;
}

function localDocsBase(base: string): string {
  if (base.length === 0 || base === "/") return "/";
  let start = 0;
  let end = base.length;
  while (base[start] === "/") start += 1;
  while (end > start && base[end - 1] === "/") end -= 1;
  return `/${base.slice(start, end)}/`;
}

function localDocsUrl(port: string, base: string): string {
  const normalized = localDocsBase(base);
  return `http://127.0.0.1:${port}${normalized}reference/metta/`;
}

function npmDocsScript(
  root: string,
  script: "docs:build" | "docs:dev",
  scriptArgs: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["--prefix", "docs-site", "run", script, "--", ...scriptArgs], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${script} exited with ${code ?? "unknown status"}`));
    });
  });
}

async function runDocsCommand(args: readonly string[], json: boolean): Promise<void> {
  const roots = positionalArgs(args);
  if (roots.length > 1) throw new Error("metta-lsp doc accepts at most one workspace root");
  const root = docsRepoRoot();
  const workspaceRoot = roots[0] ?? "examples";
  const defaults = defaultMettaDocsOptions(root);
  const result = await generateMettaDocs({
    ...defaults,
    moduleRoots: parseRootList(root, flagValue(args, "--module-roots"), workspaceRoot),
    hostRoots: parseRootList(root, flagValue(args, "--host-roots"), workspaceRoot),
  });
  const summary = {
    docsRoot: result.docsRoot,
    sidebarPath: result.sidebarPath,
    modules: result.moduleCount,
    symbols: result.symbolCount,
    hostOperations: result.hostOperationCount,
    sourceFingerprint: result.index.sourceFingerprint,
  };
  if (json) print(summary, true);
  else
    console.log(
      `Wrote ${result.docsRoot}: ${result.moduleCount} modules, ${result.symbolCount} symbols, ${result.hostOperationCount} host operations.`,
    );

  const base = flagValue(args, "--base");
  if (args.includes("--build"))
    await npmDocsScript(root, "docs:build", [], base === undefined ? {} : { VITEPRESS_BASE: base });

  if (args.includes("--serve") || args.includes("--open")) {
    const port = flagValue(args, "--port") ?? "5173";
    const localBase = base ?? "/";
    if (!json) console.log(`Serving ${localDocsUrl(port, localBase)}`);
    await npmDocsScript(
      root,
      "docs:dev",
      ["--host", "127.0.0.1", "--port", port, ...(args.includes("--open") ? ["--open"] : [])],
      { VITEPRESS_BASE: localBase },
    );
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return;
  }
  const json = args.includes("--json");
  const operands = positionalArgs(args);
  if (!command) usage();
  if (command === "lsp" && args.includes("--stdio")) {
    await import("../server/server.js");
    return;
  }
  if (command === "mcp" && args.includes("--stdio")) {
    await import("../mcp/server.js");
    return;
  }
  if (command === "capabilities") {
    print(
      { capabilities: CAPABILITY_IDS, summary: capabilitySummary(), ledger: CAPABILITIES },
      true,
    );
    return;
  }
  if (command === "repl") {
    await startRepl(operands[0]);
    return;
  }
  if (command === "doc" || command === "docs") {
    await runDocsCommand(args, json);
    return;
  }
  if (command === "list") {
    if (operands.length !== 1 || operands[0] !== "stdlib") usage();
    const catalog = stdlibCatalog();
    if (json) print(catalog, true);
    else console.log(renderStdlibList(catalog));
    return;
  }
  if (command === "inspect") {
    const target = operands[0];
    if (target === undefined || operands.length !== 1) usage();
    const lookup = inspectStdlib(target);
    if (!lookup.ok) {
      console.error(
        json ? JSON.stringify({ error: lookup.error }, null, 2) : renderStdlibError(lookup.error),
      );
      process.exitCode = lookup.error.code === "stdlib.ambiguous" ? 2 : 1;
      return;
    }
    if (json) print({ inspection: lookup.value }, true);
    else console.log(renderStdlibInspection(lookup.value));
    return;
  }
  const file = operands[0];
  if (!file) usage();
  // Structural search and replace treat code as data: they match a MeTTa pattern over the file's forms and
  // rewrite with a template that substitutes the captures. No analyzer, workspace, or evaluation is needed.
  if (command === "search" || command === "replace") {
    const pattern = operands[1];
    const source = fs.readFileSync(file, "utf8");
    if (command === "search") {
      if (pattern === undefined) usage();
      const matches = structuralSearch(source, pattern);
      if (json)
        print({ matches: matches.map((m) => ({ ...m, ...lineCol(source, m.start) })) }, true);
      else
        for (const match of matches) {
          const { line, col } = lineCol(source, match.start);
          console.log(`${file}:${line}:${col}  ${match.text.replaceAll(/\s+/g, " ")}`);
        }
      return;
    }
    const template = operands[2];
    if (pattern === undefined || template === undefined) usage();
    const { text, count } = structuralReplace(source, pattern, template);
    if (args.includes("--write")) {
      if (count > 0) fs.writeFileSync(file, text);
      console.log(`replaced ${count} match${count === 1 ? "" : "es"} in ${file}`);
    } else process.stdout.write(text);
    return;
  }
  const analyzer = makeAnalyzer(file);
  const uri = pathToUri(path.resolve(file));
  // The disk-aware analyzer wrapped in the ergonomic DSL surface, so the CLI and the programmatic API run
  // the exact same query methods (project config, workspace imports, and host bridge stay in effect).
  const doc = MettaDoc.over(analyzer, uri);
  switch (command) {
    case "check": {
      const diagnostics = doc.diagnostics();
      // --show-suppressed lists what a `; @suppress` directive or a lint.metta `(suppress ...)` rule hid, and
      // the reason for each, so suppression is auditable from the command line.
      print(
        args.includes("--show-suppressed")
          ? { diagnostics, suppressed: doc.suppressed() }
          : { diagnostics },
        json,
      );
      return;
    }
    case "symbols":
      print({ documentSymbols: doc.symbols() }, json);
      return;
    case "hover":
      print({ hover: doc.hover(asPosition(operands[1], operands[2])) }, json);
      return;
    case "def":
      print({ definition: doc.definition(asPosition(operands[1], operands[2])) }, json);
      return;
    case "host-type":
      print(
        { hostType: analyzer.hostTypeAt(uri, asPosition(operands[1], operands[2])) ?? null },
        json,
      );
      return;
    case "explain": {
      const explanation = analyzer.explainForm(uri, asPosition(operands[1], operands[2]));
      if (json) print({ explanation }, true);
      else console.log(explanation?.text ?? "no form at that position");
      return;
    }
    case "refs":
      print({ references: doc.references(asPosition(operands[1], operands[2])) }, json);
      return;
    case "fmt": {
      const edits = analyzer.formatDocument(uri);
      const next =
        edits.length === 1
          ? (edits[0]?.newText ?? fs.readFileSync(file, "utf8"))
          : fs.readFileSync(file, "utf8");
      if (args.includes("--check")) process.exit(next === fs.readFileSync(file, "utf8") ? 0 : 1);
      process.stdout.write(next);
      return;
    }
    case "lint": {
      const findings = doc.lint();
      if (args.includes("--fix")) {
        const source = fs.readFileSync(file, "utf8");
        // Apply non-overlapping rewrites right-to-left so earlier offsets stay valid.
        const fixes = findings
          .flatMap((finding) => (finding.fix === undefined ? [] : [finding.fix]))
          .sort((a, b) => b.start - a.start);
        let text = source;
        let lastStart = Number.POSITIVE_INFINITY;
        let applied = 0;
        for (const fix of fixes) {
          if (fix.end > lastStart) continue;
          text = text.slice(0, fix.start) + fix.newText + text.slice(fix.end);
          lastStart = fix.start;
          applied += 1;
        }
        if (applied > 0) fs.writeFileSync(file, text);
        console.log(`applied ${applied} fix${applied === 1 ? "" : "es"} to ${file}`);
        return;
      }
      // The CLI is on-demand, so it also runs the interpreter-backed semantic rules.
      const semantic = analyzer.semanticLintDiagnostics(uri);
      if (json) print({ findings, semantic }, true);
      else {
        const source = fs.readFileSync(file, "utf8");
        for (const finding of findings) {
          const { line, col } = lineCol(source, finding.start);
          console.log(
            `${file}:${line}:${col} [${finding.severity}] ${finding.ruleId}: ${finding.message}`,
          );
        }
        for (const diagnostic of semantic) {
          const level = diagnostic.severity === 1 ? "deny" : "warn";
          const message =
            typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
          console.log(
            `${file}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} [${level}] ${String(diagnostic.code)}: ${message}`,
          );
        }
      }
      process.exitCode =
        findings.some((finding) => finding.severity === "deny") ||
        semantic.some((diagnostic) => diagnostic.severity === 1)
          ? 1
          : 0;
      return;
    }
    case "test": {
      const source = fs.readFileSync(file, "utf8");
      const evaluation = await evaluateGuarded({
        source,
        uri,
        policy: analyzer.getSettings().runtime.guard,
        wrapBareExpression: false,
      });
      if (!evaluation.ok) {
        console.error(evaluation.error ?? (evaluation.blockers.join("; ") || "evaluation failed"));
        process.exit(2);
      }
      const results = classifyTestQueries(evaluation.queries);
      const summary = summarize(results);
      if (json) print({ results, summary }, true);
      else if (args.includes("--junit")) console.log(toJUnitXml(results));
      else if (args.includes("--tap")) {
        console.log(`1..${results.length}`);
        results.forEach((result, index) => {
          const line = `${result.status === "pass" ? "ok" : "not ok"} ${index + 1} - ${result.name}`;
          console.log(result.message === undefined ? line : `${line} # ${result.message}`);
        });
      } else {
        for (const result of results)
          console.log(
            `${result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "ERR "} ${result.name}${result.message === undefined ? "" : `\n     ${result.message}`}`,
          );
        console.log(
          `\n${summary.passed}/${summary.total} passed` +
            (summary.failed + summary.errored > 0
              ? `, ${summary.failed} failed, ${summary.errored} errored`
              : ""),
        );
      }
      process.exitCode = summary.failed + summary.errored > 0 ? 1 : 0;
      return;
    }
    case "run": {
      const request = {
        source: fs.readFileSync(file, "utf8"),
        uri,
        policy: analyzer.getSettings().runtime.guard,
        wrapBareExpression: false,
        // Load the file's resolved imports so a cross-file (import! &self mod) brings mod's definitions in,
        // the same way the editor's Run does through the server's importSourceMap.
        imports: analyzer.importSourceMap(uri),
        importPaths: analyzer.importPathMap(uri),
      };
      // --unguarded matches the editor's Run: no LSP caps and the host capability on, so side-effecting ops
      // (fileio, git-import!) act. The default guarded run stays capped and side-effect-free.
      const result = args.includes("--unguarded")
        ? await evaluateUnguarded(request)
        : await evaluateGuarded(request);
      print({ evaluation: result }, true);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case "trace": {
      const query = operands[1];
      if (query === undefined) usage();
      const maxSteps = Math.max(1, Number(flagValue(args, "--max") ?? "100"));
      try {
        const result = await traceReduction(
          fs.readFileSync(file, "utf8"),
          query,
          maxSteps,
          analyzer.importSourceMap(uri),
        );
        if (json) print({ trace: result }, true);
        else {
          result.steps.forEach((step, index) => {
            console.log(`${index}  ${step.join("  |  ")}`);
          });
          if (result.truncated) console.log(`... truncated at ${maxSteps} steps`);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
      }
      return;
    }
    case "visualise": {
      const query = operands[1];
      if (query === undefined) usage();
      const out = flagValue(args, "--out");
      try {
        const result = await reductionFrames(fs.readFileSync(file, "utf8"), query, {
          block: args.includes("--block"),
          imports: analyzer.importSourceMap(uri),
        });
        const html = framesToHtml(result, `${query} reduction`);
        if (out !== undefined) {
          fs.writeFileSync(out, html);
          console.log(`wrote ${result.frames.length} frames to ${out}`);
        } else process.stdout.write(html);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(2);
      }
      return;
    }
    default:
      usage();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
