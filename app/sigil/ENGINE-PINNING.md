# ENGINE-PINNING

`api/sigil/testdata/corpus.json` is pinned to **node-v8**. Regenerating it on
another JavaScript engine is a contract change, not a refresh.

## Why

`generateSigil` uses `Math.cos` and `Math.sin`. ECMAScript permits
implementation-dependent results for both. Two engines may agree today and
diverge in the last ulp after any release — and a one-bit difference in a
satellite coordinate changes the rendered SVG, which in production mints a sigil
that differs from the one the user watched form. Nothing crashes. Nothing logs.

**What is NOT at risk, and why that matters.** `hashSeed` is integer arithmetic
(`Math.imul`, xor, shifts). `clampTelemetry` uses only `sqrt`, `ceil`, `min`,
`max` and `round`, all exactly specified. `rarity` is integer permille by
construction. Every one of those columns is identical on any conforming engine.

So the engine field alone would pin data that was never in danger. The column
that can actually move is `sigilDigest` — an FNV-1a over everything
`generateSigil` emits, seeded from each row's `hash` because that is how
production derives a sigil's seed. That is the golden test this document exists
to protect.

## The rule

`corpus.json` carries an `engine` field and three transcendental probes.
`TestCorpusEngineIsPinned` (Go) fails if either changes; the TypeScript suite
checks every row's `sigilDigest`.

```text
node-v8/12.4.254.21   ✅ pinned
bun/1.3.14            ❌ refused, even though every row matched
```

`gencorpus` refuses to write on a non-pinned engine rather than letting the
failure surface later:

```bash
npm run gencorpus                          # node — writes
bun app/sigil/gencorpus.ts                 # exits 1, corpus untouched
npm run gencorpus -- --allow-engine-change # deliberate, and it has to be
```

**IMPORTANT: never change `pinnedEngine` to make a test pass.** The probes are
the only signal that transcendental math moved under you, and the failure looks
identical whether the cause is a deliberate engine switch or an engine that
silently changed its `sin` implementation in a patch release.

## Measured, not assumed

Node 22.22.2 (V8 12.4.254.21) and Bun 1.3.14 (JavaScriptCore) were compared on
this machine:

| | node-v8/12.4.254.21 | bun/1.3.14 |
|---|---|---|
| `cos(0.7)`, `sin(2.3)`, `pow(1.1,3)` | identical | identical |
| 300 corpus rows | — | **0 differ** |
| 300 geometry digests | — | **0 differ** |
| `engine` string | pinned | rejected |

Read that carefully: the two engines currently agree on everything the corpus
records. **The engine string is the only thing that catches a switch between
them** — the probes and the digests would both pass. That is not a reason to
drop the probes; they catch the other failure, an engine changing underneath a
version you already trust.

## Bun

Fine for running the TypeScript tests — no native dependencies, and meaningfully
faster. Just not for corpus generation, which is why `gencorpus` refuses.

## Open

This is a Vite web app, so every engine that runs `generateSigil` today is the
browser's, and the corpus is generated on Node. If the ceremony is ever ported to
React Native, **Hermes becomes a third engine in the chain and has not been
compared against the corpus.** Until it is, the client preview and the server
mint would be assumed rather than known to agree on that platform. Closing it
needs a device-side harness that runs the 300 seeds through `generateSigil` on
Hermes and reports the digests.

Nothing else in the determinism chain is unverified: the hash and clamp are
pinned across two languages by the corpus, and the geometry is pinned across
engines by `sigilDigest`.
