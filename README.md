# MoltenPour

Pay to pour molten metal down the screen and keep the splatter it leaves. One
purchase yields three artifacts: the **sigil**, the **Certificate of Waste**, and
the **collection entry**.

## Running it

```bash
npm install
npm run api      # Go API on :8787, ledger at ./moltenpour.db
npm run dev      # app on :5173, proxying /api
```

The ledger is a SQLite file. `npm run api -- -db :memory:` for an ephemeral one.

Set `MOLTENPOUR_SECRET` in anything but local development — it signs the owner
cookie, and the default is a published constant that anyone can forge.

## Layout

```
app/
  sigil/        hashSeed, generateSigil, clampTelemetry, rarity  ── ported to Go
  ceremony/     tiers, droplet sim, the pour screen
  certificate/  the A4 document, self-hosted Bodoni, print CSS
  collection/   the gallery
  design/       the specimen-ledger palette
api/
  sigil/        the Go half of the ported core + its corpus
  pour/         mint, and the ledger — memory and SQLite behind one Store
  session/      the signed anonymous owner cookie
  httpapi/      handlers
docs/handoffs/  the two design handoffs this is built from
```

## Whose pours are they

There is no login, no email and no password. A visitor is a random opaque id in
an HMAC-signed `HttpOnly` cookie; a pour belongs to whoever poured it. Signing is
the whole access control — an unsigned or edited cookie is treated as no cookie
at all, and its bearer silently becomes a new owner with an empty collection.

Reads are scoped to that owner, and someone else's pour returns **404, not 403**:
whether a given serial exists is not public information.

The ledger POSITION is deliberately *not* per-owner. `No. 1,284` is the Office's
ledger, and one continuous sequence is what makes the register read as
institutional rather than personal.

## The one rule that matters

`app/sigil/` is duplicated in `api/sigil/`. The client computes the seed hash,
the clamp and the rarity to preview a sigil; the server recomputes all three to
mint it. **If the two disagree, nothing crashes and nothing logs** — the user
watches one artifact form and receives a different one.

`api/sigil/testdata/corpus.json` is the referee. It is generated from TypeScript,
committed, and verified by the Go tests.

```bash
npm run gencorpus              # regenerate (writes into api/sigil/testdata/)
go test ./api/sigil/...        # Go must now agree
```

**Never regenerate the corpus to make a failing Go test pass.** Regenerating
always makes Go go green, including when TypeScript is the thing that broke. See
[app/sigil/CLAUDE.md](app/sigil/CLAUDE.md) before touching either side.

The corpus is also pinned to the JavaScript engine that produced it.
`hashSeed`, `clampTelemetry` and `rarity` are integer or exactly-specified
arithmetic and cannot drift — but `generateSigil` uses `Math.cos`/`Math.sin`,
which ECMAScript leaves implementation-dependent. Each row therefore carries a
`sigilDigest` over the emitted geometry, and `gencorpus` refuses to run on
anything but Node:

```bash
bun app/sigil/gencorpus.ts     # exits 1, corpus untouched
```

Node 22 and Bun 1.3.14 currently produce byte-identical rows, so the recorded
`engine` string — not the probes — is what catches a switch between them. See
[app/sigil/ENGINE-PINNING.md](app/sigil/ENGINE-PINNING.md).

## Two axes, deliberately separate

|             | What it is          | Values          | Drives                                            |
| ----------- | ------------------- | --------------- | ------------------------------------------------- |
| `tierIndex` | what you **bought** | 0–5             | flow rate, price, the certificate's CONSIDERATION |
| `rarity`    | what you **earned** | Common…Singular | accent pair, SUBSTANCE, CLASSIFICATION            |

Rarity is a pure function of the clamped telemetry and the tier. There is no luck
component: the brief forbids anything implying a randomized outcome.

Thresholds are tuned so Common lands near 55% of certificates, and so a client
claiming max-legal telemetry on every pour reaches Rare-to-Singular on tiers 3–5
— the claim the accepted-risk note in `app/sigil/telemetry.ts` depends on. Both
are asserted in tests. **Re-tune against the real ledger** once there is one.

Because reach scales with price, the cheap tiers genuinely cannot mint the rare
classifications. The ceremony says so on every tier button rather than letting
someone pour the free tier repeatedly wondering why:

| Sample      | Measure     | Draught | Vessel      | Crucible    | Full Pour   |
| ----------- | ----------- | ------- | ----------- | ----------- | ----------- |
| to Uncommon | to Uncommon | to Rare | to Singular | to Singular | to Singular |

`reachableRarity()` computes that from the real clamp and the real classifier, so
it cannot drift when the thresholds move. Stating a ceiling is not implying a
random outcome — the brief forbids the latter, not the former.

## Verifying

```bash
npm run typecheck
npm test                       # includes the TS↔corpus and geometry invariants
npm run gencorpus && git diff --exit-code api/sigil/testdata/corpus.json
go vet ./api/... && go test -race ./api/...
npm run verify:certificate     # renders and measures the A4 sheet, needs Chrome
```

`-race` because the ledger is the one place with real concurrency: `Append`
assigns a position and mints inside the same critical section, and a race there
means two certificates printing the same serial.

Export a real pour's sheet as a PDF — the ledger is owner-scoped, so this needs
the owner's cookie, exactly as the app does:

```bash
MOLTENPOUR_COOKIE='mp_owner=<value>' npm run certificate:pdf -- <pourId>
```

`verify:certificate` is the one worth knowing about. The certificate prints at a
fixed box with `overflow: hidden`, so content that misses the box is **clipped,
not reflowed** — a silent failure that still produces a plausible-looking sheet.
The script measures the rendered stack against the 794×1123 page box, checks the
ground survives print, checks the serial is on one line, and prints one PDF page.
Proofs land in `artifacts/certificate/`.

## Not done

- **Payments.** Receipt validation is a stub, so nothing charges for a tier.
- **Accounts.** Ownership is a cookie: clear it and the collection is gone, and
  it does not follow you to another device. Real accounts can adopt these owner
  ids later by claiming them, so nothing minted anonymously is orphaned.
- **A server-rendered PDF endpoint** for email delivery. `certificate:pdf` does
  it from the command line; putting it behind a route means running a headless
  browser in the deployment, which is an infrastructure decision.
- Server-side sigil rendering (OG images). Needs the geometry pipeline ported and
  the corpus extended to cover trait output, not just the hash.
- Fuzzing `ClampTelemetry` against a TypeScript oracle.
