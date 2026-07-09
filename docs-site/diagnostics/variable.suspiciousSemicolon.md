# Semicolon in or after a variable

`variable.suspiciousSemicolon`

<img src="/assets/animations/divider-candy.svg" alt="" class="candy-divider" />

## Message

`Variable '<name>' contains or is immediately followed by ';', which starts a comment in many MeTTa parsers; the rest of the line is ignored.`

## What it means

A `;` sits inside or directly after a variable with no space. In many MeTTa parsers `;` starts a line comment, so everything after it on that line, often the closing `)`, is silently dropped. The code you see may not be the code that runs.

## Why it happens

A comment written with no space after a variable (`$x;note`), or a `;` typed where a different separator was meant.

## How to fix it

Put a space before the comment, or remove the `;`.

```metta
(foo $x;note)    ; ';note)' is a comment — the ')' never closes 'foo'
(foo $x ;note)   ; a space makes it explicit and keeps the ')'
```

This is a hint, always reported. To silence one occurrence, add `; @suppress variable.suspiciousSemicolon` on the line above it.
