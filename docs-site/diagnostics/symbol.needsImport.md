# A known symbol that needs importing

`symbol.needsImport`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`'<name>' is a function of the built-in '<module>' module; import it with (import! &self <module>) to use it.`

or, when the name is defined in another workspace file:

`'<name>' is defined in '<path>'; import it with (import! &self "<path>") to use it.`

## What it means

An unknown head is valid data in MeTTa, so this is a **hint**, not an error. It fires when the head is exactly a name that an import would make available: a built-in module's export (json, catalog, fileio) or a symbol another file in the workspace already defines. Until you import it, the head stays an unknown symbol and is treated as data.

## How to fix it

Import the module or the file that defines it (the quick fix inserts the `import!`).

```metta
!(json-encode (1 2 3))   ; symbol.needsImport: run (import! &self json) to use json-encode
```

Controlled by the `metta.diagnostics.undefinedFunctions` setting.
