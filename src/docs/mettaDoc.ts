// SPDX-FileCopyrightText: 2026 MesTTo
// SPDX-License-Identifier: Apache-2.0
//
// Renders a MettaDoc (the parsed @doc-formal get-doc returns) to markdown, shared by the hover card and the
// builtins reference page so a documented symbol reads identically in the editor and on the site. A
// parameter or return is shown only when it carries a description; a missing type is dropped rather than
// rendered as empty backticks.

import type { MettaDoc } from "../language-service/coreRuntime.js";

// The parameter and return blocks: a bulleted **Parameters** list and a **Returns** line.
export function docDetailSections(doc: MettaDoc): string[] {
  const sections: string[] = [];
  const params = doc.params.filter((param) => param.description.length > 0);
  if (params.length > 0) {
    const rows = params.map((param) =>
      param.type.length > 0
        ? `- \`${param.type}\` — ${param.description}`
        : `- ${param.description}`,
    );
    sections.push(["**Parameters**", ...rows].join("\n"));
  }
  if (doc.return !== null && doc.return.description.length > 0) {
    sections.push(
      doc.return.type.length > 0
        ? `**Returns** \`${doc.return.type}\` — ${doc.return.description}`
        : `**Returns** ${doc.return.description}`,
    );
  }
  return sections;
}

// A full MettaDoc as one markdown block: the description followed by the parameter and return detail.
export function renderMettaDoc(doc: MettaDoc): string {
  const blocks: string[] = [];
  if (doc.description.length > 0) blocks.push(doc.description);
  blocks.push(...docDetailSections(doc));
  return blocks.join("\n\n");
}
