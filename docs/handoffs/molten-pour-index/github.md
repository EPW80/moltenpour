repo: EPW80/moltenpour
branch: main

## Last sync

date: 2026-08-06T05:03:38Z

### Updated in this project

- Recreated the full MoltenPour front end as a single mobile-first Design Component, ported from the real sim, clamp, hash and rarity code.
- Restyled the app chrome in the certificate's document language: grain, double rule, corner registration ticks, leader-dot rows.
- Rebuilt the tier selector as a ledger schedule and the vessel as a graduated measuring instrument.
- Added designed empty, settling, sealing and error states.

## Screen map

| Screen | Repo files |
| --- | --- |
| Ceremony | app/ceremony/PourScreen.tsx, app/ceremony/rig.ts, app/ceremony/metaball.ts, app/ceremony/tiers.ts, app/sigil/telemetry.ts, app/sigil/rarity.ts |
| Sigil | app/sigil/SigilSvg.tsx, app/sigil/sigil.ts |
| Certificate of Waste | app/certificate/Certificate.tsx, app/certificate/print.css, app/certificate/fonts/bodoni.css, docs/handoffs/certificate-of-waste/ |
| Collection | app/collection/Gallery.tsx, app/pour/record.ts |
| App shell / chrome | app/App.tsx, app/global.css, index.html, app/design/tokens.ts |
| Mint record fields | api/pour/pour.go |
