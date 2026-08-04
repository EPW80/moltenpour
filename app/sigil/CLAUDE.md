# app/sigil — port, don't fork

This directory is duplicated in `api/sigil/`. The client computes the seed hash and
the clamp to preview a sigil; the server recomputes both to mint it. If the two
disagree, the user watches one artifact form and receives a different one.

**Nothing crashes. Nothing logs.** `api/sigil/testdata/corpus.json` is the only thing
that catches it.

```
app/sigil/sigil.ts        hashSeed()          ─┐
app/sigil/telemetry.ts    clampTelemetry()    ─┼─ must agree, byte for byte
api/sigil/sigil.go        HashSeed/Clamp…     ─┘
api/sigil/testdata/corpus.json                ── the referee
```

`generateSigil` in `sigil.ts` is TS-only and has no Go counterpart — the server
stores the seed and the rarity, it does not render geometry.

## Workflow

TypeScript is the source of truth. Go conforms to it.

```bash
# 1. change telemetry.ts or hashSeed
npm run gencorpus                  # regenerates api/sigil/testdata/corpus.json in place
go test ./api/sigil/...            # Go must now agree
git diff api/sigil/testdata/corpus.json   # review it — an unexpected diff is the whole point
```

**IMPORTANT: never regenerate the corpus to make a failing Go test pass.** The corpus
is generated from TypeScript, so regenerating *always* makes Go's test go green —
including when the TS side is the thing that broke. If Go fails after a change you
did not intend to make to the hash, fix the code, not the corpus.

The corpus covers 300 rows across all six tiers, and every 7th row is a deliberate
overclaim (`9e9` on every field) so the clamp ceilings and the violation list are
both exercised.

## Traps, in order of how much they cost

**Floating-point op order.** `maxSpeed` uses an explicit `sqrt(a*a + b*b)`, not
`Math.hypot` / `math.Hypot`. Both languages are permitted to differ in the last ulp on
hypot, and that value feeds the hash. Any new float math in the clamp has to be written
the same way on both sides, in the same order.

**Field order in the hash.** `hashSeed` walks a fixed array. Never iterate a JS object's
keys or a Go map here; order is undefined and would drift per run and per language.

**Non-finite input.** JS `>>> 0` (ToUint32) yields 0 for NaN and Inf. Converting either
to an integer type in Go is implementation-specific per the spec, so `toUint32` pins it
to 0 explicitly. `clampTelemetry` should have zeroed these already — reaching that path
means a caller bypassed the clamp.

**`Math.imul`.** Go's native `uint32` multiply wraps identically. No helper needed — but
do not widen `h` to a wider type "for safety" on either side, which silently stops the
wraparound the hash depends on.

**`Math.round` vs `math.Round`.** JS rounds half toward +Inf; Go rounds half away from
zero. They agree on non-negative values, which is all the hash currently feeds them.
Go's `jsRound` pins the behaviour so a future signed field does not silently diverge.

**Sigil draw order.** `generateSigil` consumes its PRNG draws pool → tendrils →
satellites. That sequence is a stable output format — reordering the draws changes every
sigil that has already been minted.

**The tendril clip cap.** `CLIP_RADIUS = 194` is required, not cosmetic. The viewBox is
`0 0 400 400` with `overflow:hidden`, so any endpoint past 200 units from centre is
sliced flat.

## What is not guarded

- No fuzz testing. `go test -fuzz` against `ClampTelemetry` compared to a TS oracle would
  be a stronger guarantee than 300 fixed rows.
- The clamp bounds the damage; it does not stop cheating. See the accepted-risk note at
  the bottom of `telemetry.ts` for the escalation triggers.
