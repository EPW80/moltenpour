# Four-hour improvement plan

Reviewed 14 November 2026. Budget: one developer, four consecutive 60-minute blocks, including validation. These are proposed changes; the review did not change application code or production data.

## Scope and evidence

Reviewed the React app, Go API, SQLite ledger, anonymous sessions, simulation and sigil pipeline, certificate/export scripts, tests, deployment configuration, CI, backup script, and product/design documents.

**This checkout is MoltenPour, not a WooCommerce storefront.** There is no WordPress/WooCommerce implementation, store adapter, cart, checkout, or order API in this repository. `docs/monetization.md` describes future Stripe orders, explicitly marked unimplemented. A separate WooCommerce site's behavior cannot be verified from this checkout.

| Requested store flow | What exists here | Gap |
| --- | --- | --- |
| Products | Six hardcoded pour tiers; deployment supplies only a tier ceiling | No WooCommerce products, variations, availability sync, or product IDs |
| Cart | No implementation | No add/remove/update, persistence, totals, or cart recovery |
| Checkout | No implementation; paid mint validation is a stub | No payment session, failure/cancel/return flow, or verified payment |
| Orders | Pour records only | No commercial orders, payment status, webhook processing, refunds, or customer order history |

The four-hour objective is a reliable free-pour experience and safer operations. A working WooCommerce integration requires its actual code/store context and a separate implementation estimate. Do not enable paid tiers as a shortcut.

Validation performed:

- `npm test`: all 70 tests passed across six files.
- `npm run build`: passed, including typechecking. Vite reported a 554.13 kB minified application chunk, 142.79 kB gzip.
- `GOCACHE=/tmp/moltenpour-review-go-cache go test -race ./api/...`: all packages passed. The first ordinary Go run passed its package tests but exited on a read-only cache cleanup; rerunning with a writable cache resolved that environment issue.
- `npm run verify:certificate`: blocked before rendering by sandbox denial of the local listening port. No system Chrome binary was found. Browser flows and real printing remain unverified; findings below come from source inspection, not a live-store test.

## Block 1 — 00:00–01:00: Preserve the pour through navigation and sealing

**Goal:** A user cannot lose or accidentally replace the pour they are completing.

**Why first:** `app/App.tsx` conditionally unmounts `PourScreen` when tabs change, while retaining `phase` and `rarity`. The rig and start timestamp live inside `PourScreen`. Returning after settling creates a fresh empty rig while the shell still says “settled”; the enabled seal action can submit empty telemetry with a new timestamp. During sealing, Discard and navigation also remain available, while the outstanding mint later changes the view.

Tasks:

- **0–30 min:** Retain the ceremony instance across internal tabs, with an explicit active flag. Close the stream when leaving, pause its loop while hidden, and resume settling on return. Keep the rig, start timestamp, phase, and selected tier consistent. Successful minting must explicitly clear that retained draft; the old code relied on unmounting to clear it.
- **30–40 min:** Disable discard and conflicting navigation while a seal is pending, and add a synchronous guard against duplicate submissions. Snapshot the exact request used for retries. Close keyboard-held streams on blur/document hiding so a lost key-up does not keep pouring.
- **40–60 min:** Add focused browser regressions for leaving/returning during pouring and after settling, plus delayed mint success/failure. Use controlled API responses; keep the existing server idempotency behavior.

**Done when:** Internal tab changes preserve the original start time and telemetry; no empty replacement pour can be sealed; delayed responses cannot overwrite a newly started draft; repeated sealing returns one ledger record. A completed mint starts the next ceremony empty.

## Block 2 — 01:00–02:00: Make availability and collection failures recoverable

**Goal:** Users can tell what is available, what is loading, and how to recover from a failed read.

**Evidence:** `app/App.tsx:87` defaults to tier 3, enables every tier until config arrives, and silently ignores config failures. A late config response can change the tier during a pour. `getConfig` checks only that the ceiling is a number. Collection reads start with `[]`, so loading/failure looks empty; errors are rendered only inside `PourScreen`, and there is no collection retry control.

Tasks:

- **0–20 min:** Default to Sample. Add config loading/error/ready states and retry; require valid config before opening the stream. Validate that the ceiling is an integer in the supported range. Do not apply selection changes to an active draft.
- **20–40 min:** Add explicit collection loading/error/empty states and Retry. Place read failures where collection users can see them. After minting, merge the returned canonical record into the collection immediately so a failed refresh does not hide the new certificate.
- **40–50 min:** Add concise copy explaining that the collection belongs to this browser and clearing cookies loses access. Document the commerce matrix above and keep paid tiers unavailable without validated payment support.
- **50–60 min:** Check config timeout/malformed response, delayed config, failed initial listing, failed post-mint refresh, and successful retry.

**Done when:** Failed config never offers an unusable paid ceremony; an unavailable collection never claims to be empty; retry recovers without reloading; a successfully minted certificate remains visible after a listing failure. Product, cart, checkout, and order gaps are explicitly recorded as absent.

## Block 3 — 02:00–03:00: Protect ownership and detect ledger failures

**Goal:** Production fails safely and ledger backups have a defined consistency guarantee.

**Evidence:** `api/cmd/server/main.go:57` rejects a missing signing secret only when `MOLTENPOUR_ENV=production`; neither `fly.toml` nor the Dockerfile sets that flag. `fly.toml` probes `/api/health`, even though `/api/ready` checks the database. `scripts/backup-ledger.sh` separately downloads a live database and its WAL, treats any sidecar download failure as absence, and reports success without an integrity check. Files can change between downloads; successful transfers alone do not establish a recoverable backup.

Tasks:

- **0–15 min:** Set production mode in the deployment configuration. Reject missing and published development signing secrets in production. Also refuse production paid-tier enablement while receipt validation is unimplemented; currently a positive ceiling permits free paid-tier mints.
- **15–25 min:** Use `/api/ready` for the routing health probe, retaining `/api/health` for process liveness. Verify unreadable/unavailable storage produces a failed readiness result.
- **25–45 min:** Replace the default live-file backup procedure with a documented maintenance procedure: stop the writer, confirm it stopped, fetch the closed database, then restart with cleanup handling. Validate a local copy using an integrity check and compare the highest ledger position/serial against the source checkpoint. Fail on transfer or validation errors. Keep online backup as a later enhancement.
- **45–60 min:** Test startup refusal and readiness, and rehearse backup/restore against disposable data. Update the runbook with the maintenance interruption and restore checks. No production stop or restore is part of this planning task.

**Done when:** Production cannot start with a development signing secret or unpaid paid tiers; database failure fails routing readiness; an interrupted backup reports failure; a verified restore preserves the highest serial and the next mint advances the ledger exactly once.

## Block 4 — 03:00–04:00: Reduce idle rendering and verify complete journeys

**Goal:** Reduce unnecessary graphics work without changing artifact identity, then validate the repaired user journeys.

**Evidence:** `PourScreen` continuously steps and draws even when idle or fully settled. Its shader evaluates up to 32 blobs per field sample. `app/ceremony/metaball.ts` has no context-loss/restoration handlers. These are performance/recovery risks; actual frame times were not measured here. Existing frontend tests cover pure functions and the API client, but no complete React user journey. Certificate verification uses `proof.html`, which deliberately does not load the real app's print stylesheet.

Tasks:

- **0–20 min:** Render the vessel only when its picture changes; keep running while droplets/pool are visibly moving, then sleep at rest. Resume on input/resize. Honor hidden-page state without counting hidden time as a held stream. Compare draw calls before/after on the same device.
- **20–30 min:** Handle WebGL context loss with the existing unlit notice, preserve the rig, and rebuild the renderer on restoration. Clean up listeners and graphics resources on detach.
- **30–50 min:** Run browser checks at mobile and desktop widths: free pour → settle → seal → certificate → collection → reopen; navigation preservation; mint failure/retry; failed listing; keyboard focus loss; WebGL loss. Print from the actual certificate view in fit and full modes and verify visible content, footer, and one A4 page.
- **50–60 min:** Run the TypeScript suite/build, Go race suite, and certificate verifier in a browser-capable environment. Record measured results and any remaining blocker. If earlier fixes take longer, spend this block finishing those regressions before graphics optimization.

**Done when:** The vessel stops issuing continuous draws after reaching rest, resumes correctly, and survives context loss without changing telemetry. The repaired journeys pass at both widths; the real certificate prints intact; existing corpus and race checks stay green.

## Follow-up backlog outside the four hours

- **Commerce:** Review the actual WooCommerce repository/store first. Then estimate product/variation mapping, persistent cart, server-authoritative prices/totals, checkout cancel/failure/return handling, verified payment notifications, owner-scoped orders, atomic one-order/one-pour redemption, duplicate-event handling, refunds, and sandbox purchase tests. The existing Stripe proposal is a design document, not an integration to repair.
- **Long offline recovery:** Drafts are memory-only and new mints expire outside the five-minute timestamp window (`api/pour/pour.go`). Internal navigation fixes do not solve reloads, long outages, or browser clock errors. Durable drafts need a server-issued start/session design that preserves seed identity and replay rules.
- **Collection scale:** `Store.List` returns every record and `Gallery` mounts every sigil. Add cursor pagination and a bounded rendered page before large collections; preserve full-collection totals through a separate aggregate. No production-scale latency was measured.
- **Loading cost:** Investigate lazy loading the decorative Three.js background and certificate/collection views. Treat the build warning as a measurement lead, not proof of slow user experience.
- **Device support:** iOS orientation permission is mentioned but never requested. Add an optional user-initiated permission flow; retain pointer steering. Add broader accessibility and real-device checks.
- **Ownership and delivery:** Account/claim recovery, cross-device access, and customer-facing PDF download/email remain unfinished. The current print button and CLI export are the available delivery paths.
- **Operations:** Implement a consistent online backup mechanism and automated restore rehearsal after the maintenance backup path is proven. Keep the single-machine ledger constraint until storage architecture changes.

Do not spend this time repricing tiers, regenerating the corpus, retuning rarity, or redesigning the UI. Existing artifact identity and owner isolation are valuable invariants to preserve.
