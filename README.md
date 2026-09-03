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
  ceremony/     tiers, the metaball rig and its telemetry tap, the pour screen
  certificate/  the A4 document and its on-screen frame, self-hosted Bodoni, print CSS
  collection/   the gallery
  design/       the specimen-ledger palette
api/
  sigil/        the Go half of the ported core + its corpus
  pour/         mint, and the ledger — memory and SQLite behind one Store
  session/      the signed anonymous owner cookie
  httpapi/      handlers
docs/handoffs/  the three design handoffs this is built from
```

## The pour is the instrument

The ceremony is a WebGL metaball rig, not an animation played beside a counter.
`app/ceremony/rig.ts` integrates the fluid and taps the telemetry from inside
that same loop — droplets counted on first floor contact, peak velocity sampled
from live blob speed — while `metaball.ts` only draws it. The exact numbers the
user watches accumulate are the numbers hashed into the sigil seed: **what you
watch is what gets certified.**

The chrome around it is an editorial index register — a folio rail, a hairline
column grid, a ruled tier ledger with a sliding marker — built to the handoff in
`docs/handoffs/molten-pour-index/`. The certificate keeps its own fixed A4 box
and never reflows; on screen `CertificateView` is the frame that scales it to
the column without letting the width touch the sheet.

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

## Deploying

One image, one machine, one volume. The Go binary serves the built app and the
API on a single origin — `server -static ./dist` — because the owner cookie is
the whole access control and the client fetches `/api/pours` with no base URL.
A second origin would mean CORS, `SameSite=None` and credentialed fetches, which
is three new ways for a visitor's collection to silently become nobody's.

```bash
fly launch --no-deploy                 # or `fly apps create` if fly.toml is enough
fly volumes create moltenpour_data --size 1
fly secrets set MOLTENPOUR_SECRET=$(openssl rand -hex 32)
fly deploy
```

Locally, the same image:

```bash
docker build -t moltenpour .
docker run --rm -p 8080:8080 -v moltenpour-dev:/data -e MOLTENPOUR_SECRET=local moltenpour
```

| Variable | Default | What it is |
| --- | --- | --- |
| `MOLTENPOUR_SECRET` | the published dev constant | Signs the owner cookie. Rotating it makes every visitor a new owner with an empty collection — it is not a routine rotation. |
| `MOLTENPOUR_TRUST_PROXY` | unset | Set to `1` only behind a proxy that terminates TLS and sets `X-Forwarded-Proto` itself. Without it the cookie ships without `Secure` behind Fly; with it in front of nothing, a visitor picks their own cookie's flags. |
| `MOLTENPOUR_MAX_TIER` | `0` | Highest tier the deployment will mint. Receipt validation is a stub, so anything above 0 mints for free. The picker reads it from `GET /api/config` and shows the rest of the schedule withdrawn. |
| `PORT` | `8787` | Listen port. `-addr` still wins. |

**This must stay one machine.** `Append` assigns the global ledger position
inside a single critical section over one SQLite file. A second instance is a
second file, a second sequence, and two certificates printing No. 1 — which is
why `fly.toml` pins `max_machines_running = 1` and deploys `immediate` rather
than rolling. `fly status` showing two machines is an incident, not a scale-up.

Worth checking on every deploy, because it fails silently:

```bash
curl -si -X POST https://<app>/api/pours -d '{...}' | grep -i set-cookie
# mp_owner=...; HttpOnly; Secure; SameSite=Lax
fly logs | grep MOLTENPOUR_SECRET   # nothing, or the secret never landed
```

## Not done

- **Payments.** Receipt validation is a stub, so nothing charges for a tier.
  Deployments therefore run with `MOLTENPOUR_MAX_TIER=0` and offer the free tier
  alone; the paid rows stay on the schedule marked Withdrawn, because a register
  keeps the lines it has ruled out.
- **Accounts.** Ownership is a cookie: clear it and the collection is gone, and
  it does not follow you to another device. Real accounts can adopt these owner
  ids later by claiming them, so nothing minted anonymously is orphaned.
- **A server-rendered PDF endpoint** for email delivery. `certificate:pdf` does
  it from the command line; putting it behind a route means running a headless
  browser in the deployment — the image is `distroless/static` today, so that is
  a different base image and a much larger one.
- Server-side sigil rendering (OG images). Needs the geometry pipeline ported and
  the corpus extended to cover trait output, not just the hash.
- Fuzzing `ClampTelemetry` against a TypeScript oracle.
