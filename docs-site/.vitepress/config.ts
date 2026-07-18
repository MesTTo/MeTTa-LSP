// SPDX-FileCopyrightText: 2026 MesTTo
//
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import type { LanguageRegistration } from "@shikijs/types";
import { defineConfig, type DefaultTheme } from "vitepress";
import { mettaApiSidebar } from "./metta-sidebar.generated";

type TokenColor = {
  readonly scope: string;
  readonly settings: { readonly foreground: string };
};

type TextMateTheme = typeof githubLight & {
  readonly tokenColors?: readonly unknown[];
};

const mettaLanguage: LanguageRegistration = {
  ...(JSON.parse(
    readFileSync(new URL("../../syntaxes/metta.tmLanguage.json", import.meta.url), "utf8"),
  ) as LanguageRegistration),
  name: "metta",
  displayName: "MeTTa",
  scopeName: "source.metta",
};

const mettaLightTokenColors: readonly TokenColor[] = [
  { scope: "comment.line.semicolon.metta", settings: { foreground: "#6a737d" } },
  {
    scope: "string.quoted.double.metta,string.quoted.single.metta",
    settings: { foreground: "#032f62" },
  },
  { scope: "constant.character.escape.metta", settings: { foreground: "#005cc5" } },
  {
    scope: "constant.numeric.float.metta,constant.numeric.integer.metta",
    settings: { foreground: "#005cc5" },
  },
  { scope: "keyword.other.documentation.metta", settings: { foreground: "#6f42c1" } },
  {
    scope: "variable.other.metta,variable.language.metta",
    settings: { foreground: "#e36209" },
  },
  { scope: "support.type.builtin.metta", settings: { foreground: "#6f42c1" } },
  {
    scope: "keyword.control.metta,keyword.operator.metta",
    settings: { foreground: "#d73a49" },
  },
  {
    scope: "punctuation.section.parens.begin.metta,punctuation.section.parens.end.metta",
    settings: { foreground: "#22863a" },
  },
];

const mettaDarkTokenColors: readonly TokenColor[] = [
  { scope: "comment.line.semicolon.metta", settings: { foreground: "#8b949e" } },
  {
    scope: "string.quoted.double.metta,string.quoted.single.metta",
    settings: { foreground: "#a5d6ff" },
  },
  { scope: "constant.character.escape.metta", settings: { foreground: "#79c0ff" } },
  {
    scope: "constant.numeric.float.metta,constant.numeric.integer.metta",
    settings: { foreground: "#79c0ff" },
  },
  { scope: "keyword.other.documentation.metta", settings: { foreground: "#d2a8ff" } },
  {
    scope: "variable.other.metta,variable.language.metta",
    settings: { foreground: "#ffa657" },
  },
  { scope: "support.type.builtin.metta", settings: { foreground: "#d2a8ff" } },
  {
    scope: "keyword.control.metta,keyword.operator.metta",
    settings: { foreground: "#ff7b72" },
  },
  {
    scope: "punctuation.section.parens.begin.metta,punctuation.section.parens.end.metta",
    settings: { foreground: "#7ee787" },
  },
];

function withMettaTokenColors(
  theme: TextMateTheme,
  name: string,
  tokenColors: readonly TokenColor[],
): TextMateTheme {
  return { ...theme, name, tokenColors: [...(theme.tokenColors ?? []), ...tokenColors] };
}

const mettaLightTheme = withMettaTokenColors(githubLight, "metta-lsp-light", mettaLightTokenColors);
const mettaDarkTheme = withMettaTokenColors(githubDark, "metta-lsp-dark", mettaDarkTokenColors);

function docsBase(): string {
  const raw = process.env.VITEPRESS_BASE?.trim() ?? "/MeTTa-LSP/";
  if (raw.length === 0 || raw === "/") return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

const base = docsBase();
const mettaTsDocsUrl = "https://mestto.github.io/Meta-TypeScript-Talk/";

function siteAsset(path: string): string {
  return `${base}${path.replace(/^\//u, "")}`;
}

// The MeTTa LSP documentation site. Runtime package docs are excluded here so this site stays focused on
// editor, CLI, MCP, and generated language-server reference material.
export default defineConfig({
  title: "MeTTa LSP",
  description:
    "The MeTTa language server: hovers, run, visualise, diagnostics, reference docs, and agent tooling.",
  // Served as a project page. Point metta.docs.baseUrl at the deployed origin + this base so hover and
  // diagnostic docs links resolve here.
  base,
  srcExclude: [
    "advanced/**",
    "edsl/**",
    "guide/**",
    "learn/**",
    "typescript/**",
    "reference/core.md",
    "reference/edsl.md",
    "reference/grapher.md",
    "reference/hyperon.md",
    "reference/node-browser.md",
    "reference/packages.md",
  ],
  cleanUrls: true,
  head: [
    ["link", { rel: "icon", href: siteAsset("favicon.ico"), sizes: "any" }],
    ["link", { rel: "icon", type: "image/png", href: siteAsset("favicon.png") }],
    ["link", { rel: "apple-touch-icon", href: siteAsset("hyperon-logo.png") }],
  ],
  markdown: {
    // Use the same TextMate grammar the extension ships, so docs fences and editor fallback colouring
    // classify MeTTa atoms the same way.
    languages: [mettaLanguage],
    theme: { light: mettaLightTheme, dark: mettaDarkTheme },
  },
  themeConfig: {
    logo: { src: "/favicon.png", alt: "Hyperon" },
    nav: [
      { text: "Browser IDE", link: "/browser-ide" },
      { text: "LSP", link: "/lsp/overview" },
      { text: "Diagnostics", link: "/diagnostics/" },
      { text: "Visual editor", link: "/tools/grapher" },
      { text: "Reference", link: "/reference/metta/" },
      { text: "MeTTa TS docs", link: mettaTsDocsUrl },
      { text: "GitHub", link: "https://github.com/MesTTo/MeTTa-LSP" },
    ],
    sidebar: [
      {
        text: "Language server",
        collapsed: false,
        items: [
          { text: "Overview", link: "/lsp/overview" },
          { text: "Editor setup", link: "/lsp/editors" },
          { text: "Command line", link: "/lsp/cli" },
          { text: "Debugging", link: "/lsp/debugging" },
          { text: "Agent setup (MCP)", link: "/lsp/mcp" },
          { text: "Programmatic API", link: "/lsp/dsl" },
          { text: "Search & replace", link: "/lsp/search-replace" },
          { text: "Suppressing diagnostics", link: "/lsp/suppression" },
          { text: "Lint rules", link: "/lsp/rules" },
          { text: "Mixfix pseudocode", link: "/lsp/mixfix" },
          { text: "Browser IDE", link: "/browser-ide" },
          { text: "Visual editor", link: "/tools/grapher" },
          { text: "Runtime playground", link: "/playground" },
        ],
      },
      {
        text: "Reference",
        collapsed: false,
        items: [{ text: "Builtins reference", link: "/reference/builtins" }],
      },
      mettaApiSidebar as unknown as DefaultTheme.SidebarItem,
    ] satisfies DefaultTheme.SidebarItem[],
    socialLinks: [{ icon: "github", link: "https://github.com/MesTTo/MeTTa-LSP" }],
    search: { provider: "local" },
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "MeTTa LSP",
    },
  },
});
