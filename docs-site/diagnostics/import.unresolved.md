# Import target could not be resolved

`import.unresolved`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Import target '<path>' could not be resolved.`

## What it means

An `import!` / `include` names a module or file the workspace index cannot locate.

## Why it happens

The path is misspelled, the file is outside the indexed workspace, or a module root is missing.

## How to fix it

Correct the path, add the file to the workspace, or configure the module roots so the target resolves.

```metta
(import! &self "missing/module.metta")   ; import.unresolved
```

Controlled by the `metta.diagnostics.importResolution` setting.
