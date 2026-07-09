# Feature Coverage

This matrix maps the advertised language-server and extension features to files
in this folder. Open `examples/` as the VS Code workspace when testing the host
bridge or TypeScript plugin examples.

| Capability | Example |
| --- | --- |
| `lsp` status and capability ledger | [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta) |
| `lsp_tool` operation-dispatched agent tool | [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta), [`mcp-tool-smoke.jsonl`](mcp-tool-smoke.jsonl) |
| `lsp_diagnostics` | [`04-diagnostics.metta`](04-diagnostics.metta), [`17-prolog-diagnostics/main.metta`](17-prolog-diagnostics/main.metta) |
| `lsp_completion` | [`12-completion-and-hints.metta`](12-completion-and-hints.metta), [`19-typescript-plugin/sample.ts`](19-typescript-plugin/sample.ts) |
| `lsp_hover` | [`01-hovers.metta`](01-hovers.metta), [`18-host-bridge/main.metta`](18-host-bridge/main.metta) |
| `lsp_signature_help` | [`12-completion-and-hints.metta`](12-completion-and-hints.metta), [`19-typescript-plugin/sample.ts`](19-typescript-plugin/sample.ts) |
| `lsp_definition` | [`08-navigation.metta`](08-navigation.metta), [`11-modules/main.metta`](11-modules/main.metta), [`18-host-bridge/main.metta`](18-host-bridge/main.metta) |
| `lsp_host_type` | [`18-host-bridge/main.metta`](18-host-bridge/main.metta) |
| `lsp_references` | [`08-navigation.metta`](08-navigation.metta), [`11-modules/main.metta`](11-modules/main.metta), [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_document_symbols` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta), [`mcp-smoke.jsonl`](mcp-smoke.jsonl) |
| `lsp_workspace_symbols` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta), [`mcp-tool-smoke.jsonl`](mcp-tool-smoke.jsonl) |
| `lsp_format` | [`09-formatting.metta`](09-formatting.metta) |
| `lsp_format_range` | [`09-formatting.metta`](09-formatting.metta) |
| `lsp_rename` | [`08-navigation.metta`](08-navigation.metta) |
| `lsp_semantic_tokens` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_folding_ranges` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_inlay_hints` | [`12-completion-and-hints.metta`](12-completion-and-hints.metta) |
| `lsp_code_actions` | [`05-lint-and-suppression/demo.metta`](05-lint-and-suppression/demo.metta), [`06-type-suggestions.metta`](06-type-suggestions.metta) |
| `lsp_lint` | [`05-lint-and-suppression/demo.metta`](05-lint-and-suppression/demo.metta), [`05-lint-and-suppression/lint.metta`](05-lint-and-suppression/lint.metta) |
| `lsp_organize_imports` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_implementation` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_type_definition` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_declaration` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_document_highlight` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_will_rename` | [`11-modules/main.metta`](11-modules/main.metta). Rename `geometry.metta` and accept the import edit. |
| `lsp_linked_editing` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_document_links` | [`11-modules/main.metta`](11-modules/main.metta), [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_selection_ranges` | [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_call_hierarchy` | [`08-navigation.metta`](08-navigation.metta), [`mcp-tool-smoke.jsonl`](mcp-tool-smoke.jsonl) |
| `lsp_evaluate` | [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta) |
| `lsp_guarded_evaluate` | [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta), [`mcp-smoke.jsonl`](mcp-smoke.jsonl) |
| `lsp_run_tests` | [`10-testing.metta`](10-testing.metta) |
| `lsp_reduce_trace` | [`13-trace.metta`](13-trace.metta), [`16-debugging.metta`](16-debugging.metta) |
| `lsp_visualise` | [`02-running.metta`](02-running.metta), [`13-trace.metta`](13-trace.metta) |
| `lsp_code_lens` | [`02-running.metta`](02-running.metta), [`10-testing.metta`](10-testing.metta), [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |
| `lsp_format_on_type` | [`09-formatting.metta`](09-formatting.metta) |
| `lsp_explain` | [`07-pseudocode.metta`](07-pseudocode.metta), [`14-editor-surfaces.metta`](14-editor-surfaces.metta) |

Other extension surfaces:

| Feature | Example |
| --- | --- |
| VS Code commands and settings quick-pick | [`15-guarded-and-agent-surfaces.metta`](15-guarded-and-agent-surfaces.metta) |
| Debug adapter | [`16-debugging.metta`](16-debugging.metta) |
| Prolog parser diagnostics | [`17-prolog-diagnostics/main.metta`](17-prolog-diagnostics/main.metta) |
| TypeScript language-service plugin | [`19-typescript-plugin/sample.ts`](19-typescript-plugin/sample.ts) |
