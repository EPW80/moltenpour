# Monetizing MoltenPour

How the Office charges for a pour, what each tier costs, and what has to exist
before any of it can be taken.

**Status.** The schedule below is what the code sells: `AMOUNT_CENTS` in
`app/ceremony/tiers.ts` and `amountCents` in `api/pour/pour.go`, pinned to each
other by `api/pour/prices_test.go`. The reach figures are live too — tier 0's
0.50 reach is what makes the sample a Common in every case.

**What does not exist yet is the receipt.** `handleMint` has a stub where payment
belongs (`api/httpapi/server.go`), so a deployment that cannot charge refuses the
paid tiers: `MOLTENPOUR_MAX_TIER=0` in `fly.toml`, and the schedule renders its
paid rows as Withdrawn. Until phase 3 below lands, the free tier is the whole
product.

## The model

One-off purchase, per pour. Not a subscription, not a wallet, not a paywall on
the collection.

The product's register is one irreversible disbursement that yields three
artifacts — the sigil, the Certificate of Waste, the collection entry. A
subscription would bill the same person repeatedly for a ceremony whose entire
premise is that the metal is gone. Sell pours; keep the free one as the sample.

## The schedule

| # | Tier | Price | Net after card fees* | Ceiling | Flow (drops/s) | Metal at a full pour |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Sample | Free — 1 per owner | — | to Common | 10 | 568 g |
| 02 | Measure | USD 2.99 | 2.60 (87.1%) | to Uncommon | 16 | 910 g |
| 03 | Draught | USD 12.99 | 12.31 (94.8%) | to Rare | 20 | 1,137 g |
| 04 | Vessel | USD 29.99 | 28.82 (96.1%) | to Singular | 24 | 1,364 g |
| 05 | Crucible | USD 59.99 | 57.95 (96.6%) | to Singular | 28 | 1,592 g |
| 06 | Full Pour | USD 149.00 | 144.38 (96.9%) | to Singular | 34 | 1,933 g |

\* Stripe's standard US card rate, 2.9% + $0.30 (list rate; confirm at launch).
Stripe Tax adds 0.5% per transaction. Metal is `droplets × 3.79 g` at the 15 s
ceremony hard stop, and the certificate prints it as MASS RENDERED IRRECOVERABLE.

### Why these numbers

- **USD 2.99 is an acquisition price, not a margin price.** The fixed 30¢ alone
  is 10% of it; processing takes 12.9% of the rung and 3.1% of the anchor. Its
  job is a first purchase and a collection, not profit. This is a deliberate
  trade, stated here so nobody later "fixes" it by raising the entry rung.
- **USD 12.99 / 29.99 / 59.99 are the ladder people actually climb** — 4.3×, then
  2.3×, then 2.0×. Vessel is the intended purchase: the middle of the sheet, and
  the first rung that can reach Singular.
- **USD 149.00 is the anchor**, a deliberate 2.5× jump. It exists so that
  USD 29.99 reads as the considered line, and it is a flat number rather than
  `149.99` on purpose: charm pricing on the rungs people buy, an exact figure on
  the one they do not.
- **No rung below USD 2.50.** Below that the fixed fee eats the product; at
  USD 1.99 it is 15% on its own.
- At a fixed sales mix of 40/30/17/9/4 across the five paid rungs, average order
  value is **USD 21.55** against **USD 16.94** on the previous schedule — +27%
  gross per sale before conversion changes. Conversion is the unknown; the
  experiment worth running is on the entry rung alone (2.99 vs 3.99), never on
  the whole ladder at once.

## What a price buys, and what it does not

Reach is the share of the achievable score a tier can attain: 0.50 at tier 0
rising in steps of 0.10 to 1.00 at tier 5 (`app/sigil/rarity.ts`,
`api/sigil/rarity.go`). With the thresholds at 533 / 665 / 771, that is one
ceiling per rung for the first four, and then a shared one.

| Tier | Reach | Ceiling |
| --- | --- | --- |
| Sample | 0.50 | Common |
| Measure | 0.60 | Uncommon |
| Draught | 0.70 | Rare |
| Vessel | 0.80 | Singular |
| Crucible | 0.90 | Singular |
| Full Pour | 1.00 | Singular |

Two consequences, both stated to the buyer rather than buried:

- **The sample is a Common in every case.** Tier 0's 0.50 sits below the Uncommon
  threshold. Before this change the free and cheapest paid tiers reached the same
  ceiling, which left nothing to sell at the entry rung. The certificate's layout
  is identical across classifications, so this costs the buyer ornament, not
  dignity.
- **Vessel, Crucible and Full Pour all top out at Singular.** What the upper
  rungs add is *ease* — a higher score for the same pour — and spectacle: flow
  24 → 28 → 34, iridescence 0.25 → 0.75 → 1.00, a visibly thicker stream. They do
  not buy a higher classification, and the copy must not imply that they do.
  Fixing that would mean a fifth rarity, a fifth accent pair and a new corpus;
  it is a separate product decision, not part of a reprice.

## The free tier: one per owner

Today the free tier is unlimited. Anyone can mint free certificates at real
ledger positions indefinitely, which makes the sample a perfect substitute for
the entry tier and makes the register's one claim — a continuous sequence that
cost something — untrue.

**One free pour per owner**, enforced server-side:

- `SELECT COUNT(*) FROM pours WHERE owner_id = ? AND tier_index = 0` before the
  mint, inside the same critical section as the append.
- `freePoursPerOwner: 1` in `/api/config`, so the ceremony can say so up front
  instead of after a fifteen-second hold. The client already lists its own pours
  and can count its own Samples.
- Clearing cookies resets the allowance. That is accepted, and it is the same
  limitation as ownership itself; the existing per-IP mint limiter
  (`api/httpapi/limiter.go`, burst 5, refill 6 s) is what stops the cheap form of
  abuse, and it stays.

## Other revenue lines

| Line | Price | Decision |
| --- | --- | --- |
| **Remittance** — buy a pour for someone else | Tier price, **no markup**, delivered as a one-time claim link | Phase 4. The artifact is giftable, and this reaches buyers who would not buy for themselves |
| **Commemorative print** — A3 archival sheet, print-on-demand | **USD 65** against roughly USD 18 vendor cost | Deferred. It needs a shipping address, and that breaks the product's cleanest property: no PII at all |
| **Standing Order** (subscription) | — | Rejected for now. It undercuts the one-off premise and cannibalises the top tiers. Revisit only on repeat-purchase data; if ever, ~USD 29/month for two Vessel-class pours |
| **Auctioned low serials** | — | Rejected. Selling a chosen folio number breaks the continuous register the whole conceit rests on |

## Unit economics

Fixed cost is small and known: Fly `shared-cpu-1x` at 512 MB is $3.69/month, a
1 GB volume $0.15/month, and snapshot storage falls under the free 10 GB. Call it
**$3.85/month**, optionally plus $2/month for a dedicated IPv4.

**Break-even is two Measure pours, or one Draught.** Everything above that is
margin, which is why the real risk here is conversion, not cost.

Worked example, explicitly hypothetical — 100 paid pours at 40/30/17/9/4:

| Line | Amount |
| --- | --- |
| Gross | $2,155.04 |
| Card fees | −$92.50 |
| Stripe Tax at 0.5% | −$10.78 |
| Hosting | −$3.85 |
| **Net** | **≈ $2,048/month** |

That is ~95% of gross, before support, disputes and refunds. Watch the last two:
a single lost dispute costs the chargeback fee plus the pour, so a handful of
disputes at the entry rung can erase a day of Measure sales.

# What has to be built

Five phases. Only the first two items of phase 1 exist today; nothing else in
this section is implemented.

## Phase 1 — one price authority

Done: the schedule, the reach change, and `api/pour/prices_test.go`, which pins
the Go price table to the corpus generated from TypeScript.

Remaining: `/api/config` currently returns only `{maxTierIndex}`
(`api/httpapi/server.go`), so the client's copy of the names and prices is the
only thing the picker shows. Have it return the priced schedule as well:

```
{ maxTierIndex, pricesVersion, freePoursPerOwner,
  tiers: [{ index, name, amountCents, forSale }] }
```

The client hydrates from it and keeps its own table as the first-paint fallback —
the schedule is on screen before the config answers, and that should stay true.

## Phase 2 — orders and a processor

- `api/payments/`, a `Provider` interface with three implementations: Stripe,
  a fake for local development and CI, and `off`.
- Stripe over `net/http` rather than an SDK. The API has one direct dependency
  today (`modernc.org/sqlite`); a checkout-session POST, an idempotency key and a
  webhook HMAC check are about 150 lines, and the tests run offline.
- Create the session with inline `price_data` and `unit_amount` **from the
  server's table**, never from the request body. Stripe then holds no second
  price list that can disagree with the ledger. `client_reference_id` is the
  order id; the idempotency key is the order id too.
- New tables, additive like the existing `schema`: `orders` and `stripe_events`
  (event id primary key, so a redelivered webhook is a no-op).
- Routes: `POST /api/orders`, `GET /api/orders/{id}`, `GET /api/orders`,
  `POST /api/stripe/webhook`. The webhook takes no owner cookie and is outside
  the mint rate limiter.
- `main.go` refuses to start if a paid tier is for sale while payments are off —
  the same shape as the existing `MOLTENPOUR_SECRET` refusal.

Order lifecycle:

```
pending → paid → consumed
             ↘ refunded        (before consumption only)
pending → expired             (checkout abandoned)
```

## Phase 3 — receipts at mint

The part that has to be exactly right.

- `MintKey` gains an `OrderID`, and `Store.Append` consumes the order **inside
  the existing critical section**. SQLite: a conditional
  `UPDATE orders SET status='consumed', consumed_pour_id=? WHERE id=? AND
  owner_id=? AND status='paid' AND tier_index=?` in the same immediate
  transaction as the pour insert, requiring `RowsAffected == 1` or rolling back.
  The memory store does it under the same mutex. Anything weaker lets one
  receipt mint two certificates.
- A replay returns the stored record **without consuming a second credit** — the
  replay branch already returns before the mint.
- A failed mint leaves the credit paid and unspent, which is what makes the
  existing "the pour has been kept; seal it again" behaviour safe to keep.
- **402 Payment Required** for a paid tier with no usable receipt, plus a
  `payment_required` code in `app/pour/api.ts`.
- The free-tier cap is enforced here, in the same transaction.

**The ceiling has to learn about receipts.** A tier is mintable when it is for
sale *or* the owner holds a paid order at that tier. Without that,
`MOLTENPOUR_MAX_TIER=0` stops being a kill switch and becomes a way to strand
people who have already paid.

## Phase 4 — the ceremony, and gifting

- Payment comes **before** the pour. A paid tier with no credit turns the action
  into a remittance; the vessel opens once the order is paid. Nobody should lose
  a completed pour to a declined card.
- On return from checkout, poll the order until the webhook lands and say so in
  the notice band. The redirect alone must never mark anything paid.
- The app has no router today, so the return is a query parameter read once on
  mount and stripped with `history.replaceState`.
- Default selection moves from tier 3 (`app/App.tsx`) to tier 0. Pre-selecting
  USD 29.99 is a conversion trick the register's voice should not use.
- Remittance: a one-time claim link that moves a paid order to another owner.
  Ownership is a cookie, so a buyer who switches browser needs exactly this
  mechanism — and the link is a bearer secret, with a stated expiry.

## Phase 5 — operations

- Reconciliation, read-only: Stripe charges against `orders`, credits `paid` and
  unconsumed for more than 24 h, refunds after consumption.
- Backups now cover financial evidence as well as the register; the existing
  script already pulls the database and its WAL together.
- `MOLTENPOUR_MAX_TIER` remains the kill switch, with the receipt exception
  above.

# Prices are part of the artifact

`amountCents` is a field of `BurnSeed`. A tier's price is hashed into the sigil,
so it is not a display value — it is part of what the pour *is*.

- **A reprice is a corpus change.** Edit `AMOUNT_CENTS`, regenerate
  `api/sigil/testdata/corpus.json` under Node 22, then make the Go table agree.
  Never regenerate to quiet a failing Go test; that is the one rule in
  `app/sigil/CLAUDE.md`, and a reprice is not an exception to it.
- **Never reprice retroactively.** The ledger stores the amount paid per pour,
  and the certificate prints it. Old certificates stay exactly as issued.
- **A stale client is the remaining hazard.** A browser holding a bundle built
  against the old prices would preview a different sigil than the ledger mints.
  Once charging is live, carry `pricesVersion` in `/api/config` and in the mint
  request, and refuse a mismatch with 409 and a reload.
- `api/pour/prices_test.go` fails if the two tables disagree by so much as a
  cent. That test exists because the corpus alone does not catch it: the sigil
  tests re-hash with the corpus's own amount.

# Tax, refunds, disputes

- **Tax.** A pour is a digital service delivered immediately. EU and UK sales
  attract VAT at the buyer's rate; several US states tax digital goods. Stripe
  Tax at 0.5% per transaction plus an OSS registration is the cheap path at these
  price points. A merchant of record removes the registration but charges roughly
  5% + 50¢ — **22% of a USD 2.99 pour** — which is a poor trade here.
- **Refunds.** Before consumption, yes. After a pour is minted, no: the artifact
  is delivered, and its serial and position cannot be unissued. That has to be
  stated plainly at checkout, with the express consent the EU withdrawal waiver
  for digital content requires.
- **Disputes.** Evidence is the paid order, the minted serial, `issued` and the
  owner's collection entry. A chargeback also costs the dispute fee, which at the
  entry rung is several pours' worth of revenue.
- **Not a game of chance.** Rarity is a pure function of the clamped telemetry
  and the tier, with the ceiling printed on every tier button. Keep it that way:
  no odds, no "win", no implied random outcome, no resale value. That is both the
  brief and the difference between a purchase and a wager.
- **No email, no recovery channel.** Ownership is a cookie. The terms should say
  what that means rather than promising account recovery that cannot exist.

# Launch and what to watch

1. Ship phase 1 and the free-tier cap. The product still sells nothing; the
   schedule simply stops being the client's own claim.
2. Phase 2 and 3 against Stripe test mode, with the fake provider in CI. Exit
   criteria: twenty end-to-end test purchases, a deliberate double-consume that
   fails, a refund before consumption, `npm run verify:certificate` still green.
3. Go live at `MOLTENPOUR_MAX_TIER=2` for a week — the entry and volume rungs
   only — then raise to 5. Rollback is `MOLTENPOUR_MAX_TIER=0`, with the receipt
   exception keeping already-sold credits spendable.
4. Phase 4 gifting once the one-off funnel is understood.

Watch: paid pours per config load, checkout abandonment, 402 rate, webhook lag,
credits paid and unspent after 24 h, refund and dispute rate, and the ledger's
rarity mix per tier. The last one is the input to re-tuning the thresholds, which
are still calibrated against uniform noise rather than real pours — the corpus
spread moved to 71% Common when the free tier became Common-only, and that
number is a modeling artefact, not a forecast.

# Open decisions

- **Entry rung, 2.99 vs 3.99.** The one experiment worth running. 3.99 lifts the
  entry net from 2.60 to 3.57 (+37%) if conversion holds.
- **A fifth rarity** to give Crucible and Full Pour distinct ceilings. Large:
  new accent pair, new substance, corpus, Go port, certificate re-measurement.
- **Commemorative print** at USD 65. Deferred until the PII question is answered
  deliberately rather than by accident.
- **Accounts.** Not needed to charge, but a paid receipt is a stronger argument
  for them than a free collection ever was.



