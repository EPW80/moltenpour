# Four-hour improvement plan

Reviewed and executed 15 November 2026. This replaces the 14 November plan, which
is now largely implemented in the tree (pour preserved across navigation, config
loading/error/retry states, production safety checks, `/api/ready` probe, online
backup/rehearsal path, render-loop sleep, WebGL context-loss recovery).

This pass delivered four one-hour blocks. Nothing here touches artifact identity,
rarity thresholds, prices, or the corpus; the sigil pipeline and owner isolation
are untouched.

## Block 1 — ceremony correctness

- **Orientation permission handling is implemented.** `app/ceremony/PourScreen.tsx`
  checks for sensor API support, requests `DeviceOrientationEvent.requestPermission()`
  on the first click (after touch activation), and attaches on grant. Platforms
  without a permission method attach immediately; unsupported or denied sensors
  retain pointer steering. Physical iOS verification remains in the backlog.
- **A lapsed pour is now told to begin again.** `api/pour` gains `ErrClockSkew`;
  `handleMint` returns 400 with a machine-readable `code:"expired"`; the client
  maps it to `ApiError.code === "expired"`, renders a plain explanation, and resets
  the retained draft to idle instead of offering a seal that can never succeed.
- **A negative `MOLTENPOUR_MAX_TIER` can no longer brick the free tier.**
  `api/cmd/server` floors the ceiling to `[0, MaxTierIndex]` via `clampTierCeiling`.

## Block 2 — the accepted-risk review is now runnable

- `api/pour/audit.go` adds a read-only `Audit` that aggregates the two escalation
  triggers in `app/sigil/telemetry.ts`: telemetry overclaims on >2% of pours, and
  Singular share on tiers 3–5 above twice the corpus's modeled rate
  (`ModeledSingularShare345 = 4/150`, pinned to the corpus by a test).
- `go run ./api/cmd/server -audit <db>` prints the table and exits 1 on alarm;
  `scripts/ledger-audit.sh` wraps it. The smoke test now exercises the flag.
  On the local dev ledger it correctly flags 1 overclaim of 11 pours (9.09%).

## Block 3 — hardening

- `app/ErrorBoundary.tsx` turns a render error into an on-brand recovery panel +
  reload instead of a white screen; mounted in `app/main.tsx`.
- `handleMint` requires a second decode to return `io.EOF`, rejecting trailing
  JSON, malformed delimiters, and body-limit errors while accepting whitespace
  within the request limit.
- `app/collection/Gallery.tsx` mounts the first 60 tiles and offers "Show more",
  so a large collection no longer renders every sigil at once.

## Block 4 — shipping weight and ops

- The collection, certificate and Three.js background are now `React.lazy` +
  `Suspense`. The app entry is about **39 kB**, with a required **147 kB shared
  chunk**: roughly **186 kB (61 kB gzip)** before interaction. The separate
  **517 kB (130 kB gzip)** Three.js background waits for the first pointer or
  keyboard interaction. Splitting alone previously still fetched it at startup.
  It unmounts on the certificate view; its downloaded module remains cached.
- `scripts/restore-rehearsal.sh` scripts the README restore checklist: verify a
  snapshot, boot a server on a disposable copy, mint once, and assert the new
  position is one past the snapshot's maximum. It defaults to an OS-assigned
  port, requires the child's successful-bind log before polling readiness, and
  refuses an occupied requested port before minting. Failed runs retain their
  disposable copy and logs for inspection.

## Validation

- `npm run typecheck` — clean.
- `npm test` — 78 tests passed (6 files), including the new `expired` mapping test.
- `go vet ./api/...` — clean; `go test -race ./api/...` — all packages pass
  (clock-skew, audit, tier-ceiling, trailing-JSON/body-limit, and restore tests).
- `npm run verify:journeys` — desktop/mobile journeys pass, including unsupported
  sensors, activation-gated touch permission, and background loading after input.
- `./scripts/smoke.sh` — passes, including the new audit check.
- `./scripts/restore-rehearsal.sh` — minted position 12 on a snapshot whose max
  was 11.
- `npm run gencorpus` — regenerated with the **same rows** under Node 24 but a
  different recorded engine string (`node-v8/13.6…` vs the pinned `node-v8/12.4…`),
  confirming the pinning sentinel works as designed. The committed corpus is
  unchanged; CI regenerates and checks it under Node 22.

## Remaining backlog (out of these four hours)

- **Commerce.** Receipt validation is still a stub; paid tiers stay gated behind
  `MOLTENPOUR_MAX_TIER=0` until a real store/checkout exists (see
  `docs/monetization.md`).
- **Durable drafts.** The client now reports a lapsed pour honestly, but reloads
  and >5-minute idle still lose an in-progress pour. A server-issued draft session
  is the real fix.
- **Server-side cursor pagination** for the gallery once collections are large
  enough to matter (the client now bounds render; the API still returns every
  record).
- **Server-rendered PDF endpoint** for email/delivery (needs headless Chrome in
  the image → a larger base image).
- **iOS orientation permission polish + broader real-device/a11y pass.**
- **Accounts/claim** so an anonymous owner cookie can later be adopted.
