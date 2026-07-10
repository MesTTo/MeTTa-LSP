// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Biome (biome.json) owns formatting, import organization, and the non-type-aware lint baseline.
// ESLint runs ONLY the rules Biome cannot: the type-checker-backed correctness rules, the cross-package
// architecture boundaries, the node-builtin ban on the pure language-service, and neverthrow must-use.
// No escape hatches: every rule below holds on the whole tree, and the code is fixed to pass rather than
// the rules relaxed.

import js from "@eslint/js";
import neverthrow from "@ninoseki/eslint-plugin-neverthrow";
import vitest from "@vitest/eslint-plugin";
import { type Linter } from "eslint";
import { defineConfig } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import importX from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import regexp from "eslint-plugin-regexp";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const parserOptions = {
  projectService: {
    allowDefaultProject: ["eslint.config.ts", "eslint.ci.config.ts"],
  },
  tsconfigRootDir: import.meta.dirname,
} as const;

const settings = {
  "import-x/resolver": { typescript: true },
  // eslint-plugin-boundaries reads the plain `import/resolver` key, not import-x's.
  "import/resolver": { typescript: true },
  "boundaries/elements": [
    { type: "language-service-entry", pattern: "src/language-service/index.ts", mode: "full" },
    { type: "language-service-internal", pattern: "src/language-service/**", mode: "full" },
    // Neutral, browser-safe leaves (no node builtins) that live under src/server/ for now but are
    // depended on across adapters; Phase 1 relocates them into the language-service core. Ordered before
    // the general `server` pattern so the more-specific classification wins.
    { type: "core-shared", pattern: "src/server/shared/**", mode: "full" },
    { type: "core-shared", pattern: "src/server/parser.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/types.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/capabilities.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/builtins.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/semanticTokensBuilder.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/guardedEvaluationTypes.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/runnableForms.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/docsLinks.ts", mode: "full" },
    { type: "core-shared", pattern: "src/server/fileProvider.ts", mode: "full" },
    { type: "server", pattern: "src/server/**", mode: "full" },
    { type: "runtime", pattern: "src/runtime/**", mode: "full" },
    { type: "debug", pattern: "src/debug/**", mode: "full" },
    { type: "mcp", pattern: "src/mcp/**", mode: "full" },
    { type: "cli", pattern: "src/cli/**", mode: "full" },
    { type: "dsl", pattern: "src/dsl/**", mode: "full" },
    { type: "client", pattern: "src/client/**", mode: "full" },
    { type: "scripts", pattern: "scripts/**", mode: "full" },
  ],
} satisfies Linter.Settings;

// Type-aware and architecture rules Biome cannot express.
const rules: Linter.RulesRecord = {
  // Type-aware correctness absent from strictTypeChecked.
  "@typescript-eslint/switch-exhaustiveness-check": ["error", { requireDefaultForNonUnion: true }],
  "@typescript-eslint/prefer-readonly": "error",
  "@typescript-eslint/no-import-type-side-effects": "error",
  // Kills the falsy-zero bug class (a nullable number where 0 is valid): `if (n)` must become an explicit
  // `n !== undefined`/`n > 0`. Strings stay allowed (only "" is falsy, low risk); nullable booleans are
  // handled explicitly.
  "@typescript-eslint/strict-boolean-expressions": [
    "error",
    {
      allowString: true,
      allowNullableString: true,
      allowNumber: false,
      allowNullableNumber: false,
      allowNullableBoolean: false,
      allowNullableObject: true,
      allowAny: false,
    },
  ],
  // Tightened preset defaults.
  "@typescript-eslint/no-floating-promises": ["error", { checkThenables: true }],
  "@typescript-eslint/no-unnecessary-condition": ["error", { checkTypePredicates: true }],
  "@typescript-eslint/only-throw-error": [
    "error",
    { allowThrowingAny: false, allowThrowingUnknown: false },
  ],
  "@typescript-eslint/restrict-template-expressions": [
    "error",
    { allowNumber: true, allowBoolean: true, allowNever: true },
  ],
  "@typescript-eslint/ban-ts-comment": [
    "error",
    {
      "ts-expect-error": "allow-with-description",
      "ts-ignore": true,
      "ts-nocheck": true,
      minimumDescriptionLength: 5,
    },
  ],
  "@typescript-eslint/no-confusing-void-expression": [
    "error",
    { ignoreArrowShorthand: true, ignoreVoidOperator: true },
  ],
  // Off: async interface-conformance (framework hooks, repository methods) is async by contract.
  "@typescript-eslint/require-await": "off",
  // Biome's useImportType + verbatimModuleSyntax own type-import syntax.
  "@typescript-eslint/consistent-type-imports": "off",

  // Architecture Biome cannot enforce.
  "import-x/no-cycle": "error",
  "neverthrow/must-use-result": "error",

  // Curated unicorn prefer-native (not its opinionated style rules — Biome owns style).
  "unicorn/prefer-node-protocol": "error",
  "unicorn/prefer-string-replace-all": "error",
  "unicorn/prefer-array-find": "error",
  "unicorn/prefer-array-some": "error",
  "unicorn/prefer-includes": "error",
  "unicorn/prefer-set-has": "error",
  "unicorn/prefer-spread": "error",
  "unicorn/prefer-string-slice": "error",
  "unicorn/prefer-string-starts-ends-with": "error",
  "unicorn/prefer-structured-clone": "error",
  "unicorn/prefer-regexp-test": "error",
  "unicorn/no-useless-spread": "error",

  // ReDoS.
  "regexp/no-super-linear-backtracking": "error",
  "regexp/no-super-linear-move": "error",
  "regexp/no-empty-alternative": "error",

  // Cognitive-complexity is a heuristic, not a correctness gate, so we do not block on it. The adopted
  // v11 analyzer has large functions that Phase 1's engine split decomposes naturally.
  "sonarjs/cognitive-complexity": "off",

  // Node correctness (resolution is TypeScript's job, so the import-existence rules stay off).
  "n/prefer-node-protocol": "error",
  "n/no-missing-import": "off",
  "n/no-unsupported-features/es-syntax": "off",

  // Cross-package boundaries: the pure language-service depends on nothing; every adapter reaches it ONLY
  // through its index.ts entrypoint (never its internals). default-disallow catches undeclared edges too.
  "boundaries/dependencies": [
    "error",
    {
      default: "disallow",
      rules: [
        {
          from: { type: "language-service-entry" },
          allow: { to: { type: ["language-service-entry", "language-service-internal"] } },
        },
        {
          from: { type: "language-service-internal" },
          allow: { to: { type: ["language-service-entry", "language-service-internal"] } },
        },
        // Neutral leaves depend only on each other and the language-service entry.
        {
          from: { type: "core-shared" },
          allow: { to: { type: ["language-service-entry", "core-shared"] } },
        },
        {
          from: { type: "runtime" },
          allow: { to: { type: ["language-service-entry", "core-shared", "runtime"] } },
        },
        {
          from: { type: "debug" },
          allow: { to: { type: ["language-service-entry", "core-shared", "runtime", "debug"] } },
        },
        {
          from: { type: "server" },
          allow: { to: { type: ["language-service-entry", "core-shared", "server", "runtime"] } },
        },
        {
          from: { type: "mcp" },
          allow: {
            to: { type: ["language-service-entry", "core-shared", "mcp", "server", "runtime"] },
          },
        },
        {
          from: { type: "cli" },
          allow: {
            to: {
              type: [
                "language-service-entry",
                "core-shared",
                "cli",
                "server",
                "runtime",
                "mcp",
                "dsl",
              ],
            },
          },
        },
        {
          // The ergonomic DSL is a thin facade over the analyzer and guarded runtime.
          from: { type: "dsl" },
          allow: {
            to: { type: ["language-service-entry", "core-shared", "dsl", "server", "runtime"] },
          },
        },
        {
          from: { type: "client" },
          allow: { to: { type: ["language-service-entry", "core-shared", "client"] } },
        },
        {
          from: { type: "scripts" },
          allow: {
            to: {
              type: [
                "language-service-entry",
                "language-service-internal",
                "core-shared",
                "server",
                "runtime",
                "mcp",
                "cli",
                "client",
                "scripts",
              ],
            },
          },
        },
      ],
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "coverage/**",
      // The tsserver plugin entry is a CommonJS `export =` module bundled by esbuild, outside the ESM src
      // tsconfig; it is verified by the vitest integration test and the build/load smoke instead.
      "typescript-plugin/**",
      // The docs site is a self-contained VitePress sub-project with its own package.json and toolchain;
      // the repo's biome/eslint/tsc/knip do not lint the duplicated site.
      "docs-site/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx,mts,cts}"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: { parserOptions },
    settings,
    plugins: {
      "@ninoseki/neverthrow": neverthrow,
      boundaries,
      "import-x": importX,
      n,
      neverthrow,
      regexp,
      sonarjs,
      unicorn,
    },
    rules,
  },
  // The pure package: no node builtins (browser-safe), explicit public API return types.
  {
    files: ["src/language-service/**/*.{ts,mts,cts}"],
    rules: {
      "import-x/no-nodejs-modules": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  // The analysis core (parser, types, builtins, the analyzer, the neutral leaves) is browser-safe and must
  // import no node builtin, even while it still physically lives under src/server/ pending the package
  // relocation. This locks in the purity the pure package and the browser host both depend on.
  {
    files: [
      "src/server/analyzer.ts",
      "src/server/parser.ts",
      "src/server/types.ts",
      "src/server/builtins.ts",
      "src/server/semanticTokensBuilder.ts",
      "src/server/guardedEvaluationTypes.ts",
      "src/server/docsLinks.ts",
      "src/server/fileProvider.ts",
      "src/server/shared/**/*.{ts,mts,cts}",
      // The pure, host-independent parts of the grounded-atom bridge: the analyzer depends on these, so they
      // must stay browser-safe. The concrete `hostTypeService`/`overlayHost` (which own a ts.LanguageService)
      // are deliberately NOT here — they are node-only and injected, never imported by the analyzer.
      "src/server/bridge/hostBridge.ts",
      "src/server/bridge/hostBindingView.ts",
      "src/server/bridge/groundedSite.ts",
      "src/server/bridge/typeTable.ts",
    ],
    rules: { "import-x/no-nodejs-modules": "error" },
  },
  // The eslint config files run type-aware on the default project (a couple of files, under the type
  // service's default-project cap); relax the immutability + node-only strictness.
  {
    files: ["eslint.config.ts", "eslint.ci.config.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions },
    rules: {
      "sonarjs/cognitive-complexity": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  // Build and smoke scripts are plain ESM run outside the program. Parse them WITHOUT the type-aware
  // project service, so adding scripts never trips its default-project file cap (which concurrency was
  // masking), and turn off the type-checked rules that would need the service.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: false, sourceType: "module", ecmaVersion: "latest" },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "sonarjs/cognitive-complexity": "off",
    },
  },
  // Standalone integration tests are transpiled by Vitest and are intentionally outside tsconfig.json.
  {
    files: ["test/**/*.{ts,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: false, sourceType: "module", ecmaVersion: "latest" },
    },
    rules: tseslint.configs.disableTypeChecked.rules,
  },
  // Tests are not shipped code: keep behavior assertions, relax the immutability and unsafe-value rules.
  {
    files: ["**/*.{test,spec}.{ts,mts,cts}", "test/**/*.{ts,mts,cts}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-disabled-tests": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
