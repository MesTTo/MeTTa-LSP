# Import does not run without a leading !

`import.notRun`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`This import does not run: without a leading !, a top-level (import! …) is inert data, so <module>'s symbols stay undefined at runtime. Prefix it with ! to run it.`

## What it means

A top-level `(import! …)` written without a leading `!` is data, not a query: the interpreter stores the atom and never executes the import, so the module's definitions never load and its symbols are undefined when the file runs. Navigation still resolves them across the file boundary, which is exactly why the mistake is easy to miss.

## Why it happens

The import is written bare, `(import! &self lib)`, instead of as a run query, `!(import! &self lib)`.

## How to fix it

Add the leading `!` so the import runs. The quick fix does this.

```metta
(import! &self lib)    ; inert data — lib never loads
!(import! &self lib)   ; runs — lib's definitions are in scope
```

Controlled by the `metta.diagnostics.importResolution` setting.
