// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// The TypeScript language-service plugin entry, CommonJS (`export =`) as tsserver requires. It wires
// microsoft/typescript-template-language-service-decorator to MettaTemplateService so MeTTa `m`/`mAll` tagged
// templates in a .ts file light up with MeTTa diagnostics, completion, hover, signature help, navigation,
// references, outlining, and quick-fixes. esbuild bundles this together with the compiled adapter (from
// dist/, produced by `npm run compile`) into one self-contained CommonJS file with only `typescript`
// external, so any editor's tsserver loads it from a tsconfig `plugins` entry. It lives outside the ESM
// `src/` tree because `export =` is invalid in an ES module.

import type * as ts from "typescript/lib/tsserverlibrary";
import { decorateWithTemplateLanguageService } from "typescript-template-language-service-decorator";
import { decorateStringArgs } from "../dist/embedded/decorateStringArgs.js";
import { MettaTemplateService } from "../dist/embedded/mettaTemplateService.js";

// A `${...}` interpolation becomes an equal-length MeTTa variable placeholder, so it parses as a single atom
// and stays inert to undefined-symbol and arity diagnostics.
function substitution(_template: string, start: number, end: number): string {
  return `$${"x".repeat(Math.max(0, end - start - 1))}`;
}

function init(modules: { typescript: typeof ts }): ts.server.PluginModule {
  const { typescript } = modules;
  return {
    create(info: ts.server.PluginCreateInfo): ts.LanguageService {
      // One service backs both surfaces: the decorator handles the `m`/`mAll` tagged templates, then
      // decorateStringArgs adds the eDSL's plain-string calls (parseSource/db.q/db.run) on top.
      const service = new MettaTemplateService(typescript);
      const withTemplates = decorateWithTemplateLanguageService(
        typescript,
        info.languageService,
        info.project,
        service,
        {
          tags: ["m", "mAll"],
          enableForStringWithSubstitutions: true,
          getSubstitution: substitution,
        },
      );
      return decorateStringArgs(typescript, withTemplates, service);
    },
  };
}

export = init;
