import {
  assertCapabilityParity,
  CAPABILITY_IDS,
  capabilitySummary,
} from "../dist/server/capabilities.js";

const required = [
  "lsp",
  "lsp_tool",
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_document_symbols",
  "lsp_workspace_symbols",
  "lsp_implementation",
  "lsp_call_hierarchy",
  "lsp_diagnostics",
  "lsp_completion",
  "lsp_signature_help",
  "lsp_code_actions",
  "lsp_semantic_tokens",
  "lsp_inlay_hints",
  "lsp_folding_ranges",
  "lsp_format",
  "lsp_format_range",
  "lsp_organize_imports",
  "lsp_rename",
  "lsp_document_highlight",
  "lsp_linked_editing",
  "lsp_document_links",
  "lsp_selection_ranges",
  "lsp_type_definition",
  "lsp_declaration",
  "lsp_evaluate",
  "lsp_guarded_evaluate",
  "lsp_code_lens",
  "lsp_explain",
  "lsp_lint",
  "lsp_run_tests",
  "lsp_reduce_trace",
  "lsp_host_type",
];
for (const id of required) {
  if (!CAPABILITY_IDS.includes(id)) throw new Error(`capability missing from registry: ${id}`);
}
assertCapabilityParity("mcp", required);
const summary = capabilitySummary();
if (summary.total < required.length)
  throw new Error(`capability summary unexpectedly small: ${summary.total}`);
console.error("capability smoke ok");
