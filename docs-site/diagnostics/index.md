# Diagnostics catalogue

Every diagnostic the MeTTa language server reports, with what it means and how to fix it. Editors link a
diagnostic's code straight to its page here, so you always see the full explanation, not just the one-line
message.

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

| Code | Diagnostic |
| --- | --- |
| [`call.arity`](/diagnostics/call.arity) | Wrong number of arguments |
| [`call.typeMismatch`](/diagnostics/call.typeMismatch) | Argument type mismatch |
| [`definition.duplicate`](/diagnostics/definition.duplicate) | Duplicate definition |
| [`import.unresolved`](/diagnostics/import.unresolved) | Import target could not be resolved |
| [`import.notRun`](/diagnostics/import.notRun) | Import form is not run |
| [`space.unbound`](/diagnostics/space.unbound) | Unbound atom-space symbol |
| [`symbol.possibleTypo`](/diagnostics/symbol.possibleTypo) | Possible typo in a call head (hint) |
| [`symbol.needsImport`](/diagnostics/symbol.needsImport) | A known symbol that needs importing (hint) |
| [`type.undefined`](/diagnostics/type.undefined) | Undefined type in a signature |
| [`variable.undefined`](/diagnostics/variable.undefined) | Free variable in a body |
| [`variable.reservedHash`](/diagnostics/variable.reservedHash) | Variable name contains '#' |
| [`variable.suspiciousSemicolon`](/diagnostics/variable.suspiciousSemicolon) | Variable name contains ';' |
