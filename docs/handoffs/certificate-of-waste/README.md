# Handoff: Certificate of Waste

## Overview
A single-page, print-ready certificate issued after a purchase in **MoltenPour** — a mobile app
where you pay to pour molten metal down the screen and keep the splatter it leaves. The certificate
is one of three post-purchase artifacts (the others: the sigil itself, and the collection entry);
this handoff covers **only the certificate**.

Register is deadpan institutional: a bank document about something idiotic, played completely
straight. It never winks. If a design choice feels playful, it is wrong.

Visually it is styled to match the wider MoltenPour "specimen ledger" system (see the sibling
handoff for *Molten Tribute Index*): aubergine void ground, molten-gold ink, hairline rules,
corner registration ticks, dotted leaders, monospace instrument labels against high-contrast
Bodoni display. Zero border radius anywhere. This is a deliberate departure from the original
brief's Times-serif-throughout spec — the certificate now shares the product's typographic voice.

## About the Design Files
The files here are **design references created in HTML** — a working, printable prototype showing
intended look and output. They are **not production code to copy directly**.

Recreate this in the target codebase's own environment and patterns. Two parts differ in kind:
- **The document layout** (frame, type, ledger table, footer) — rebuild with the codebase's
  primitives. It is plain flex layout and text; no dependencies.
- **The sigil generator** (`buildSigil` + `rng` + `poolPath`) — pure, framework-agnostic geometry
  that emits SVG from an integer seed. **Lift it verbatim.** Do not re-derive the math; the radius
  budgets are tuned to stay inside the viewBox (see "Sigil generator").

## Fidelity
**High-fidelity, and print-exact.** Colors, type scale, spacing and copy are final. The page is
tuned to fill an A4 sheet precisely — verified at 794×1123 px (96 dpi), aspect 1.414, no clipping.
Any size change must be re-measured against the page box (see "Print geometry").

## Print geometry — read before changing anything
The document is **explicitly paginated**: exactly one page, ISO 216 portrait (A4), full-bleed.
It is not a flowing document; there is no second page and no reflow.

- The page prints at a **fixed box with `overflow: hidden`** — content that misses the box is
  **clipped**, not pushed to a next sheet.
- Total content height at 794px width must stay **≤ 1123px**. The current stack lands exactly on
  it. Budget, top to bottom:
  `52px top padding + 39px header strip + 20px title gap + ~104px title block + sigil (flexes,
  ≤300px) + 16px caption + 8 rows × ~26px + 30px "for nothing" + 39px footer + 46px bottom padding`.
- The sigil is the **only flexible element**: its wrapper is `flex:1; min-height:0` and the SVG is
  `flex:0 1 auto; max-width:300px; max-height:100%`. If content is added, the sigil shrinks first —
  and it is the thing that should shrink. Everything else is fixed.
- **Do not** author `@page` rules, paper dimensions, page-break CSS, or fake sheet cards; the
  document shell owns print geometry.
- **Do not** use viewport units anywhere in the page — they track the window, not the sheet, and
  mis-size at print.
- Dark backgrounds are intentional here and must survive print: the port must set
  `print-color-adjust: exact` (and `-webkit-print-color-adjust: exact`) on the page, or browsers
  will drop the plum ground and the certificate prints as gold text on white.
- A4 vs Letter: A4 is the design target (ISO 216 ratio is specified by the product). On Letter the
  sheet is wider and shorter — the layout still fits (it is height-critical, not width-critical),
  but re-measure if you change the vertical stack.

## Layout — single page, top to bottom

**Page ground**
- `background: radial-gradient(115% 70% at 50% -10%, #2A1136 0%, #1A0E1E 48%, #120A15 100%)`
- Base text `#C9A24A`; base font `ui-monospace, "SF Mono", Menlo, monospace`
- Grain overlay (optional, prop `grain`): absolute inset 0, `opacity:.14`,
  `mix-blend-mode: overlay`, inline-SVG `feTurbulence` data-URI
  (`type=fractalNoise baseFrequency=.9 numOctaves=3`, 140×140 tile), `pointer-events:none`
- Inner vignette: absolute inset 0, `box-shadow: inset 0 0 120px 40px rgba(10,6,13,.55)`
- Content inset: `padding: 52px 62px 46px`, `height:100%`, `box-sizing:border-box`,
  flex column

**Double rule + corner ticks** (all absolute, `pointer-events:none`)
- Outer rule: `inset:26px`, `1px solid rgba(201,146,46,.5)`
- Inner rule: `inset:33px`, `1px solid rgba(201,146,46,.24)`
- Four 15×15 ticks at `top/bottom:40px` `left/right:40px`, two adjacent borders each
  `1px solid rgba(245,214,122,.7)`

**1. Header strip**
- Flex row, `space-between`, `align-items:baseline`, `gap:20px`, `padding-bottom:14px`,
  `border-bottom:1px solid rgba(201,146,46,.28)`
- 12px / `letter-spacing:2.6px` / uppercase / secondary accent
- Left: `Molten Pour · Office of Disbursement` —
  `min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`
- Right: the serial, `white-space:nowrap`, tabular-nums.
  **Both nowrap rules are load-bearing**: a serial number broken across two lines reads as a
  document defect. Shorten or ellipsis the office label; never wrap the serial.

**2. Title block** (centered, `gap:9px`, `padding-top:20px`)
- H1 `CERTIFICATE OF WASTE` — Bodoni Moda 400, 34px, `line-height:1`,
  `letter-spacing:8px` with matching `text-indent:8px` (cancels the trailing letterspace so the
  centering is true), `#F7E9C2`, `text-shadow: 0 0 40px rgba(201,146,46,.3)`
- Subtitle `ISSUED UPON IRREVERSIBLE DISBURSEMENT` — 12px / 3.4px / uppercase / `#B08A3C`
- Motto rule: 290px-wide flex row, `gap:14px` — fading hairline
  (`linear-gradient(90deg, transparent, rgba(201,146,46,.55))`), Bodoni italic 17px
  `letter-spacing:2px` in the accent reading *non revertitur*, mirrored hairline

**3. Sigil** — `flex:1; min-height:0`, centered, `padding:6px 0 2px`. See "Sigil generator".

**4. Sigil caption** — centered, 12px / 3px / uppercase / secondary, tabular-nums:
`POUR №1,284 · <CLASSIFICATION> · <SUBSTANCE>`, `padding-bottom:16px`

**5. Ledger table** — 8 rows, each a flex row, `align-items:baseline`, `gap:16px`,
`padding:5px 2px 4px`, `border-bottom:1px solid rgba(201,146,46,.2)`:
1. label — 12px / `letter-spacing:2.4px` / uppercase / secondary accent, `white-space:nowrap`
2. dotted leader — `flex:1`, 1px tall,
   `repeating-linear-gradient(90deg, rgba(201,146,46,.3) 0 1px, transparent 1px 5px)`
3. value — Bodoni Moda 17px, `letter-spacing:.4px`, accent, tabular-nums, `white-space:nowrap`

**6. Inscription** — centered, `padding:16px 0 14px`, Bodoni italic 22px,
`letter-spacing:1.5px`, `#F7E9C2` — *for nothing*

**7. Footer** — flex, `space-between`, `align-items:flex-end`, `gap:20px`, `padding-top:14px`,
`border-top:1px solid rgba(201,146,46,.28)`, 12px / 1.9px / uppercase / `#B08A3C`
- Left (`max-width:70%`): `THIS INSTRUMENT CONFERS NO RIGHT, CLAIM, OR RESIDUAL VALUE.`
  — required to be clearly legible, never decorative or dimmed further
- Right: Bodoni italic 14px, secondary accent, lowercase — `rev. vii — mmxxvi`

## Content (exact copy)

| Label | Value |
|---|---|
| SERIAL | MP-0001284-6AE8 |
| LEDGER POSITION | No. 1,284 |
| SUBSTANCE | *tier-dependent* |
| CLASSIFICATION | *tier-dependent* |
| MASS RENDERED IRRECOVERABLE | 310.97 g |
| BATCH | 277-T |
| CONSIDERATION | *tier-dependent* |
| ISSUED | 2026-08-02 |

In production, every value comes from the pour record. Labels are fixed strings; `MASS RENDERED
IRRECOVERABLE` is formatted to 2 decimals with a ` g` suffix; `LEDGER POSITION` uses a thousands
separator and a `No. ` prefix; `ISSUED` is ISO `YYYY-MM-DD` (no localized dates — the deadpan
register depends on it).

## Tier system
`tier` selects an accent pair and three strings. Default `Singular`.

| Tier | Accent | Secondary | Substance | Consideration |
|---|---|---|---|---|
| Common | `#D8BC7E` | `#B08A3E` | Brass | Free |
| Uncommon | `#F5D67A` | `#C9922E` | Gold | USD 2.99 |
| Rare | `#FFF6D8` | `#E8C260` | Alloy | USD 24.99 |
| Singular | `#E8BCF2` | `#C97AD8` | Living Metal | USD 99.99 |

Accent = table values, motto, sigil pool core. Secondary = all labels, header strip, caption,
sigil satellites and tendrils, footer folio.

**About Common:** roughly 55% of all certificates will be Common. It must not read as a
consolation prize — the layout, rule weights, glow and type are identical across tiers; only the
accent pair and three strings change. Do not add tier badges, extra ornament for high tiers, or
anything that visually demotes Common. An unknown tier falls back to `Singular` in the prototype;
in production, fall back to `Common` and log — silently upgrading a tier is worse than a wrong
color.

## Sigil generator
A deterministic splatter mark: one integer seed → identical SVG every time. This matters — the
sigil is the artifact the user owns, so it must be reproducible from the pour record, not
re-rolled at render time.

- `rng(seed)` — mulberry32. Seeded PRNG, no `Math.random()` anywhere. Consumption order is part of
  the output: pool → tendrils → satellites. **Reordering the draws changes every existing sigil.**
  Treat the sequence as a stable format.
- `poolPath(r, cx, cy, base)` — 12 lobes at even angles, radius `base * (0.74 + r() * 0.44)`,
  joined into a closed quadratic path through segment midpoints (a smooth irregular blob, not a
  polygon).
- **Fill** — `radialGradient` 50%/50%/50%: accent @ 0% (opacity .95) → secondary @ 55%
  (opacity .42) → `#1A0E1E` @ 100% (opacity .05). Stroke: accent, opacity .55, width 0.9.
  Gradient ids are seed-suffixed (`pool-<seed>`) so multiple sigils on one page don't collide.
- **9 tendrils** — straight lines at `(i/9)*2π + 0.18`, from `base*0.94` out to
  `min(194, base*0.94 + 32 + r()*100)`. Stroke secondary, opacity `.5–.9`, width `0.7–2.8`.
  The `min(194, …)` cap is **required**: the viewBox is `0 0 400 400` with `overflow:hidden`, so
  any endpoint past 200 units from center gets sliced flat. Verified: max coordinate 394 of 400
  across seeds.
- **26 satellites** — circles at `(i/26)*2π ± 0.04` jitter (near-symmetrical spacing: this pour
  was steady, and the evenness is the story), radius `base + 42 + r()*74` from center, r `1.9–6.5`,
  secondary fill at opacity `.55–.95`.
- Geometry: `cx=cy=200`, `base=74`, viewBox `0 0 400 400`. Rendered `width/height:100%` with
  `max-width:300px`, `max-height:100%`, `flex:0 1 auto`, `margin:0 auto`, `aria-hidden="true"`.
- **Invariant to test:** for any seed in 1–9999, every line endpoint and circle extent stays within
  2…398. Add that as a unit test in the port.

## Tweakable props (design-time controls)
Three props are declared on the prototype. All have hard-coded fallbacks so the document renders
correctly with no props passed — preserve that.

| Prop | Type | Default | Range | What it does | Port as |
|---|---|---|---|---|---|
| `tier` | enum | `Singular` | Common / Uncommon / Rare / Singular | Swaps the accent pair plus SUBSTANCE, CLASSIFICATION and CONSIDERATION. Read as `TIERS[props.tier] ? props.tier : 'Singular'`. | Real data field from the pour record — not a control. Change the production fallback to `Common`. |
| `grain` | boolean | `true` | — | Toggles the `feTurbulence` overlay (`opacity:.14`, `mix-blend-mode:overlay`). Off = clean, noticeably more digital. | Theme flag. Consider `false` for the print/PDF path if the target printer muddies the overlay, and for any low-end device — `mix-blend-mode` is the cheapest thing to drop. |
| `sigilSeed` | int | `1284` | 1–9999 | Seed for the sigil generator. Nothing else in the document responds to it. | Derived from the pour record (e.g. the ledger position or a hash of the serial), never random at render. Widen past 9999 freely — the geometry is bounded. |

Note the prototype's seed and the printed serial/ordinal are independent; in production derive one
from the other so the sigil on the certificate always matches the sigil in the collection.

## Hard constraints (from the product brief — carry into the port)
- No banknotes, no coins resembling real currency, no dollar-sign iconography. US currency imagery
  has legal restrictions; the product uses abstract metal only. Prices are set as plain text
  (`USD 99.99`), never a currency glyph or a money graphic.
- No emoji, no exclamation marks, no celebratory copy. No "Congratulations", no confetti, no burst
  graphics.
- No mystery boxes, wrapped gifts, spinning wheels, chests, or any UI implying a randomized
  outcome. Rarity is earned from how the user poured, and nothing may suggest otherwise.
- No fire, flames or embers. The substance is liquid metal, not burning money.
- No "Buy again" / "Pour again" call to action anywhere on the certificate.
- Every text element clears 4.5:1 against the ground; **nothing below `#A07E3A` for text at any
  size**. Current values: `#B08A3C` ≈ 5.7:1, `#C97AD8` ≈ 6.3:1.

## Interactions & Behavior
Static document — no interactive state, no animation, no data fetching at render time. It is a
render target: pour record in, sheet out.

- Text is authored as static markup so it stays directly editable in review tools; keep it that way
  rather than injecting strings through a render function.
- The sigil is decorative for assistive tech (`aria-hidden="true"`); the same information is in the
  ledger table as text. Keep it that way.
- Accessibility at print: the table is visually a label/leader/value row set. In the port, mark it
  up as a real `<dl>` or `<table>` with a caption so screen readers get the pairs — the prototype's
  flex rows are a visual approximation.
- Expected production path: server- or client-side render this page to PDF for email delivery and
  in-app download. Because it is a single fixed sheet, a headless-Chrome print at A4 with
  background graphics enabled reproduces it exactly.

## Design Tokens

**Color**
| Token | Hex | Use |
|---|---|---|
| void-plum | `#2A1136` | page gradient top |
| plum | `#1A0E1E` | page gradient mid, sigil gradient rim |
| void-deep | `#120A15` | page gradient bottom |
| gold-cream | `#F7E9C2` | title, "for nothing" |
| gold-hot | `#F5D67A` | corner ticks, Uncommon accent |
| gold-body | `#C9A24A` | base text color |
| gold-label | `#B08A3C` | subtitle, footer disclaimer |
| rule-strong | `rgba(201,146,46,.5)` | outer border rule |
| rule | `rgba(201,146,46,.28)` | header/footer rules |
| rule-mid | `rgba(201,146,46,.24)` | inner border rule |
| rule-row | `rgba(201,146,46,.2)` | table row rules |
| leader | `rgba(201,146,46,.3)` | dotted leaders |
| tick | `rgba(245,214,122,.7)` | corner registration ticks |
| shade | `rgba(10,6,13,.55)` | inner vignette |

Plus the four tier accent pairs above.

**Type**
- Display: **Bodoni Moda** (Google), 400 + italic 400 — title 34px/`ls 8px`; table values 17px;
  motto italic 17px; inscription italic 22px; folio italic 14px.
- Instrument: `ui-monospace, "SF Mono", Menlo, monospace`, uppercase, **12px floor** with
  letter-spacing 1.9 / 2.4 / 2.6 / 3 / 3.4px. Nothing smaller — fine print here still has to be
  read, and 12px is the contrast/legibility floor for this document.
- All numerics `font-variant-numeric: tabular-nums`.

**Spacing** — recurring: 2, 4, 5, 6, 9, 14, 16, 20, 26, 33, 40, 46, 52, 62px. Page inset
`52px 62px 46px`; border rules at 26/33px; ticks at 40px.

**Radius** — none. Not a stylistic accident; the document has no rounded corner anywhere.

**Effects**
- title glow `0 0 40px rgba(201,146,46,.3)`
- inner vignette `inset 0 0 120px 40px rgba(10,6,13,.55)`
- grain `opacity:.14` + `mix-blend-mode:overlay`

## Assets
None. No images, no icon set, no illustration files. The sigil is generated at render time from a
seed; the grain is a procedural `feTurbulence` data-URI. Fonts load from Google Fonts (Bodoni
Moda) — swap to the codebase's font pipeline if it self-hosts, and self-host for the PDF path so
rendering never depends on a network fetch.

## Files
- `Certificate of Waste.dc.html` — the design: markup, inline styles, tier map, sigil generator.
  Opens in a browser; prints to a single A4 sheet.
- `doc-page.js` — the paged-document shell that owns print geometry (fixed page box, `@page
  margin:0`, no browser date/URL chrome). Prototype infrastructure: **do not port it**, replace it
  with the target stack's print/PDF setup.
- `support.js` — prototype runtime so the HTML opens standalone. **Not part of the design**; do not
  port.
- `design-prompt-delivery-mockup.md` — the original product brief for all three post-purchase
  artifacts, including the hard constraints, the register notes, and the full tier table. Read it
  for intent; where it conflicts with the design above (Times serif, `#7A3A8C` border, flat plum
  ground), the design above is the newer decision.
