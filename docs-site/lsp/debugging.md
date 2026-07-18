# Debugging

MeTTa LSP has two complementary debugging views.

The Trace command shows the grapher reduction states for a query:

```bash
metta-lsp trace examples/13-trace.metta "(sum-to 3)" --max 8
```

The VS Code command **MeTTa: Why Did This Reduce?** uses the `@metta-ts/debug`
engine trace. Put the cursor on a runnable `!` query or bare call, then run the
command. If the cursor is not on a runnable form, the server explains the file's
last runnable query.

The output channel reports:

- result atoms,
- grounded reducer counts, such as `top-k-by-atom: 1`,
- higher-order specialization, such as `twice -> twice$inc`,
- stack-overflow cut points,
- total reduction count.

For a small queue reducer:

```metta
(: Score (-> Expression Number))
(= (Score (item $name $score)) $score)
(= (Score ()) -99999.0)
(: LimitSize (-> Expression Number Expression))
(= (LimitSize $L $size)
   (top-k-by-atom Score $size $L))
!(LimitSize ((item a 1) (item b 3) (item c 2)) 2)
```

`why` reports the result `((item b 3))`, the grounded reducer
`top-k-by-atom: 1`, and the engine reduction count.

## Debug Adapter

The VS Code debug adapter still steps frames with the grapher reducer, so
**Next** moves through expression states. It also exposes a **Trace** scope from
the engine trace. The scope contains `reductions`, `events`, `grounded:<op>`
variables, `specialized[N]` entries, and `overflow[N]` cut points.

When the engine reports a native stack overflow, **Continue** stops at the
overflow cut-point atom and prints `stack overflow cut-point: ...` in the Debug
Console. The Reduction scope still shows the current expression and step count.
