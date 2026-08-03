# HANDOFF — sigil pipeline (TypeScript ↔ Go)

Status: verified. 300-row corpus matches across both languages, `go vet` clean.

## What this covers

The seed hash and telemetry clamp exist twice, once per language. The client
computes them to preview a sigil; the server recomputes them to mint it. If the
two disagree, the user watches one artifact form and receives a different one.
Nothing crashes and nothing logs.

```
app/sigil/sigil.ts        hashSeed()          ─┐
app/sigil/telemetry.ts    clampTelemetry()    ─┼─ must agree, byte for byte
api/sigil/sigil.go        HashSeed/Clamp…     ─┘
api/sigil/testdata/corpus.json                ── the referee
```

## Files

| File | Lands at | Notes |
|---|---|---|
| `sigil.go` | `api/sigil/sigil.go` | Go port. No deps beyond `math`. |
| `sigil_test.go` | `api/sigil/sigil_test.go` | Reads the corpus; fails loudly on drift. |
| `corpus.json` | `api/sigil/testdata/corpus.json` | Generated, committed, never hand-edited. |
| `gencorpus.ts` | `app/sigil/gencorpus.ts` | Regenerates the corpus from the TS side. |

## The workflow

TypeScript is the source of truth. Go conforms to it.

```bash
# 1. change telemetry.ts or hashSeed
npx vite-node app/sigil/gencorpus.ts        # regenerate
cp corpus.json api/sigil/testdata/          # ship it to Go
go test ./api/sigil/...                     # Go must now agree
```

**IMPORTANT: never regenerate the corpus to make a failing Go test pass.** The
corpus is generated from TS, so regenerating always makes Go's test go green —
including when the TS side is the thing that broke. If Go fails after a change
you did not intend to make to the hash, fix the code, not the corpus.

The corpus covers 300 rows across all six tiers, and every 7th row is a
deliberate overclaim (`9e9` on every field) so the clamp ceilings and the
violation list are both exercised.

## Traps, in order of how much they cost

**Floating-point op order.** `maxSpeed` uses an explicit `sqrt(a*a + b*b)`, not
`Math.hypot` / `math.Hypot`. Both languages are permitted to differ in the last
ulp on hypot, and that value feeds the hash. Any new float math in the clamp has
to be written the same way on both sides, in the same order.

**Non-finite input.** Converting NaN or Inf to an integer type in Go is
implementation-specific per the spec; JS `ToUint32` yields 0. `toUint32` pins
this to 0 so the hash can never be platform-dependent. `ClampTelemetry` should
have zeroed these already — reaching that path means a caller bypassed the clamp.

**Field order in the hash.** `HashSeed` walks a fixed slice. Never iterate a Go
map or a JS object's keys here; order is undefined and would drift per run and
per language.

**`Math.imul`.** Go's native `uint32` multiply wraps identically. No helper
needed — but do not widen `h` to `uint64` "for safety," which silently stops
the wraparound the hash depends on.

## Corrected during this work

Two things I got wrong that are worth knowing, because both looked right:

1. **The int64-truncation trap does not exist.** I documented `toUint32` as
   guarding against a naive port hashing the full 64-bit timestamp. It doesn't —
   the hash loop reads only bytes 0-3, which is already the low 32 bits, so the
   naive port yields the same value. Verified with a deliberate wrong
   implementation, which produced an identical hash. The comment now says what
   the helper actually guards.

2. **`append([]string(nil), s...)` returns nil for an empty slice.** The first
   test run failed with `go: [] ts: []` because `reflect.DeepEqual` distinguishes
   `nil` from `[]string{}`. Test bug, not a port bug, but it cost a cycle.

## Not done

- `generateSigil` itself is TS-only. The server stores the seed and rarity; it
  does not render geometry. If server-side rendering is ever needed (OG images
  for the feed, say), the whole geometry pipeline has to be ported and the
  corpus extended to cover trait output, not just the hash.
- No fuzz testing. `go test -fuzz` against `ClampTelemetry` comparing to a TS
  oracle would be a stronger guarantee than 300 fixed rows.
- The corpus is not checked in CI against a fresh TS regeneration. A CI step
  that regenerates and diffs would catch a TS-side change that forgot step 2 of
  the workflow above.
