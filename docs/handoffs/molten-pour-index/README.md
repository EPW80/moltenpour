# Handoff: Molten Pour — Index Redesign

## Overview

A full front-end redesign of **Molten Pour** (`github.com/EPW80/moltenpour`), an app in which a
user holds a vessel, pours molten currency for a fixed span of time, and receives a
**Certificate of Waste** bearing a procedurally generated sigil derived from how they poured.

The redesign replaces the app's generic bordered-box chrome with an **editorial index**
register: an oversized Bodoni display head, a vertical folio rail, a hairline column grid,
a ruled tier ledger with a sliding illuminated marker, and a 9:16 instrument panel in which
a WebGL metaball rig renders the pour.

The single most important change is architectural, not cosmetic: **the fluid simulation the
user watches is the same simulation that produces the telemetry.** In the current app the
pour is an SVG animation and the telemetry is computed alongside it. Here the metaball rig
*is* the instrument — droplets are counted on first floor contact, peak velocity is sampled
from live blob velocity, and those exact numbers are hashed into the sigil seed. What you
watch is what gets certified.

Three views: **the ceremony**, **the collection**, **the certificate**.

## About the design files

The file in this bundle is a **design reference created in HTML** — a working prototype that
demonstrates intended look, motion, and behavior. It is **not production code to copy
directly.**

`Molten Pour Index.dc.html` is authored in a component format specific to the design tool it
was made in: a template section using `{{ }}` value holes and `<sc-if>` / `<sc-for>` control
flow, plus a logic class exposing values through a `renderVals()` method. Treat that wrapper
as scaffolding. **What you want out of it is the markup structure, the exact inline style
values, the GLSL shader, and the simulation/scoring logic** — all of which are plain,
portable, and match the repo's existing TypeScript.

The task is to recreate this design in the target codebase's own environment. Molten Pour is
already **React 18 + TypeScript + Vite**, so the mapping is direct:

- The logic class becomes a React component (hooks or class — the rig wants a ref-heavy,
  imperative style either way).
- Template markup becomes JSX. `{{ x }}` → `{x}`, `<sc-if value>` → `{cond && …}`,
  `<sc-for list as>` → `{list.map(…)}`, `onClick="{{ fn }}"` → `onClick={fn}`.
- Inline `style="…"` strings become style objects, or move to the project's existing styling
  approach. Values are given exactly in **Design tokens** below; nothing needs to be measured
  off a screenshot.

Much of the logic in the prototype is a **direct port of code that already exists in the
repo** and should be re-used from source rather than re-typed — see **Reuse from the repo**.

## Fidelity

**High fidelity.** Colors, typography, spacing, timings, and easings are final and exact.
Recreate pixel-perfectly. The one deliberately soft area is responsive behavior below 900px,
which is described by intent rather than by a full second comp — see **Responsive behavior**.

---

## Reuse from the repo — do not re-implement

The prototype ports these verbatim so it could run standalone. In the real codebase, **import
the originals**; the prototype copies exist only to make the HTML self-contained.

| Concern | Source of truth |
| --- | --- |
| `SIM` constants (gravity 1400, spawnVyMax 120, spawnVxMax 45, maxPourMs 15000, maxTiltRate 6, dropletTolerance 1.15) | `app/sigil/telemetry.ts` (consumed by the rig in `app/ceremony/rig.ts`) |
| Tier table, flow rates, amounts | `app/ceremony/tiers.ts` |
| `clampTelemetry` and violation reporting | `app/sigil/telemetry.ts` |
| FNV-1a `hashSeed` | `app/sigil/sigil.ts` |
| `pourScore`, thresholds, `classify` | `app/sigil/rarity.ts` |
| Sigil geometry (pool path, tendrils, satellites) | `app/sigil/sigil.ts`, `app/sigil/SigilSvg.tsx` |
| Record shape: serial, batch, mass, ledger position | `app/pour/record.ts`, `api/pour/pour.go` |
| Certificate print geometry | `app/certificate/print.css`, `app/certificate/Certificate.tsx` |

The rarity thresholds (`uncommon: 533`, `rare: 665`, `singular: 771`), the score weighting
(fill 40 / force 25 / commitment 20 / steadiness 15), and the tier reach curve
(`55 + 9 × tierIndex`) are all **server-mirrored** — the Go API recomputes them. Do not tune
them from the front end.

**Genuinely new in this design** (build these):

1. The WebGL metaball rig and its GLSL shader.
2. The telemetry tap inside the rig's integration loop.
3. The live spec-bar readout painted from the animation loop.
4. The classification progression bar with threshold ticks.
5. The whole index layout, tier ledger, and side rail.

---

## Screens / Views

### 1. The ceremony

**Purpose.** Choose a tier, hold the vessel to pour, watch telemetry accumulate, then seal
the pour into a certificate.

**Layout.** Page root is a CSS grid, `grid-template-columns: 36px minmax(0,1fr)` at ≥900px
(the 36px track is the vertical folio rail, which spans all four rows), collapsing to
`minmax(0,1fr)` below. Column gap `clamp(16px, 2.4vw, 30px)`. Page padding
`clamp(18px,3vw,30px) clamp(16px,3vw,34px) 0`.

Rows, in order: header, nav, main, footer.

Main is itself a grid: `minmax(260px,1fr) minmax(340px,440px)` at ≥900px — vessel left,
ledger right — collapsing to one column below. Gap `clamp(26px,3vw,44px)`, `align-items:
start`.

**Background.** `radial-gradient(115% 75% at 50% -12%, #2A1136 0%, #170D1C 46%, #0A060D 100%)`
on `#0C070F`. Over it, a full-bleed non-interactive overlay at `opacity: .5` carrying
`repeating-linear-gradient(90deg, rgba(201,146,46,.055) 0 1px, transparent 1px 96px)` — the
96px column rule that gives the page its ledger-paper feel.

#### Vertical folio rail (≥900px only)

`grid-row: 1 / span 4`, `border-right: 1px solid rgba(201,146,46,.14)`, contents
`writing-mode: vertical-rl`, space-between, `padding-bottom: 26px`.

- Top: `Office of Disbursement · Folio 1284` — 11px, `letter-spacing: 4.5px`, uppercase, `#B08A3C`.
- Bottom: `non revertitur` — Bodoni Moda italic 14px, `letter-spacing: 1px`, `#8A6A2A`.

#### Header

Flex, wrap, `align-items: flex-end`, space-between, gap `16px 24px`,
`border-bottom: 1px solid rgba(201,146,46,.24)`, `padding-bottom: 18px`.

Left column (gap 10px):
- Eyebrow: `A schedule of disbursements, rendered in liquid` — 11px, `letter-spacing: 3.6px`,
  uppercase, `#B08A3C`.
- `<h1>` `The Molten Pour` — Bodoni Moda 400, `font-size: clamp(38px, 5.2vw, 62px)`,
  `line-height: .92`, `letter-spacing: -1px`, `#F7E9C2`,
  `text-shadow: 0 0 44px rgba(201,146,46,.35)`.

Right column (align-end, gap 10px), 11px / `letter-spacing: 2.6px` / uppercase / `#B08A3C`:
- Status row: a 14px circle, `border: 1px solid rgba(201,146,46,.35)`, `border-radius: 50%`,
  containing a 4px dot filled with the **live rarity accent**, animating
  `breathe 2.6s ease-in-out infinite`. Label text is phase-dependent:
  `Live · vessel ready` → `Live · stream open` → `Live · settling` → `Live · stream closed`.
- `rev. vii — mmxxvi` — Bodoni Moda italic 15px, `letter-spacing: .5px`, none-case, `#8A6A2A`.

#### Nav

Flex, `gap: 26px`, `padding-top: 14px`. Three text tabs (the third only appears once a
certificate exists): `The ceremony`, `The collection · {n}`, `The certificate`.

Each: 11px, `letter-spacing: 3px`, uppercase, `padding-bottom: 6px`, transparent background,
no border except `border-bottom: 1px solid`. Active → rule `#F5D67A`, text `#F7E9C2`.
Inactive → rule `transparent`, text `#8A6A2A`.

#### Vessel column

A flex row, `gap: 16px`, centered in its grid cell.

**Graduations.** A left column, space-between, `text-align: right`, 11px,
`letter-spacing: 1.6px`, `#8A6A2A`, tabular numerals, matching the stage height. Six labels
top to bottom: `15 s —`, `12 s —`, `9 s —`, `6 s —`, `3 s —`, `0 —`. These mark the ceremony's
15-second hard stop, *not* volume.

**Stage.** `aspect-ratio: 9/16`; height `min(70vh, 720px, (100vw - 720px) * 1.7778)` at
≥900px, `min(58vh, 520px)` below; `width: auto`; `max-width: 100%`.
Background `#160B1A`. Border `1px solid rgba(201,146,46,.22)`, transitioning to
`rgba(245,214,122,.6)` over `.4s linear` while the stream is open.
`box-shadow: 0 0 120px 10px rgba(201,146,46,.09), inset 0 0 0 1px rgba(12,7,15,.9)`.
`overflow: hidden`, `touch-action: none`, `user-select: none`.

It is a `role="button"` with `tabindex="0"` and `aria-label="Hold to pour"`.

Stacked inside, in order:
1. `<canvas>`, `display:block; width:100%; height:100%` — the metaball rig.
2. Grain overlay (toggleable): `opacity: .16`, `mix-blend-mode: overlay`, an inline SVG
   `feTurbulence` `fractalNoise`, `baseFrequency .9`, `numOctaves 3`, tiled at 140×140.
3. Vignette: `inset 0 0 100px 34px rgba(10,6,13,.8)`.
4. **Spout** callout at `top: 20%` — right-aligned label, 11px, `letter-spacing: 2px`,
   uppercase, `rgba(245,214,122,.72)`, preceded by a dashed rule
   `repeating-linear-gradient(90deg, rgba(245,214,122,.3) 0 3px, transparent 3px 8px)`.
   **20% is the spawn line** — the shader and the callout must agree.
5. **Pool line** callout at `top: 82%`, mirrored (label first, rule after).
   **82% is the floor line.** Same agreement requirement.
6. Four 16px corner registration ticks inset 9px, `1px solid rgba(245,214,122,.6)`.
7. Center phase label at `top: 46%`, 11px, `letter-spacing: 3.4px`, uppercase, `#F5D67A`,
   `text-shadow: 0 0 20px rgba(10,6,13,.9)`. Text: `Hold to pour` / `Stream open` /
   `Settling` / `Stream closed`; drops to `opacity: .45` when settled.
8. Bottom readout bar, `padding: 16px 26px 14px`, over
   `linear-gradient(to top, rgba(10,6,13,.9), transparent)`, 11px, `letter-spacing: 1.8px`,
   uppercase, `#B08A3C`, tabular. Left: elapsed, `0.00 s`. Right: `{n} drops · {alive}/32`.

All overlays except the canvas are `pointer-events: none`.

#### Ledger column

Flex column, `gap: 24px`, `min-width: 0`.

**Tier table.** Header row: `Tier` / `Consideration`, 11px, `letter-spacing: 3.2px`,
uppercase, `#B08A3C`, `padding-bottom: 10px`,
`border-bottom: 1px solid rgba(201,146,46,.24)`.

The rows sit in a `position: relative` wrapper containing the **marker**: an absolutely
positioned band, `left: -16px; right: -16px; height: 52px; top: 0`, background
`linear-gradient(90deg, rgba(201,146,46,.2), rgba(201,146,46,.02) 70%)`,
`border-left: 2px solid <live accent>`,
`box-shadow: -2px 0 22px rgba(245,214,122,.25)`,
`transform: translateY(idx × 52px)`,
`transition: transform .45s cubic-bezier(.22,1,.36,1)`, `pointer-events: none`.
**The 52px row height and the 52px marker step must stay locked together.**

Each of six rows is a button: `height: 52px`, flex, `align-items: center`, `gap: 12px`,
transparent, `border-bottom: 1px solid rgba(201,146,46,.1)`, `text-align: left`,
`transition: color .2s, opacity .3s`. Cells, in order:

| Cell | Style |
| --- | --- |
| Index `01`–`06` | 11px, `letter-spacing: 1.6px`, `#8A6A2A`, tabular |
| Tier name | 12px, `letter-spacing: 2.8px`, uppercase, `nowrap` |
| Leader | `flex: 1; min-width: 12px; height: 1px`, `repeating-linear-gradient(90deg, rgba(201,146,46,.35) 0 1px, transparent 1px 5px)` |
| Reach, e.g. `to Rare` | 11px, `letter-spacing: 1.4px`, uppercase, `#8A6A2A`, `nowrap` |
| Price | Bodoni Moda 17px, `letter-spacing: .2px`, tabular, `nowrap` |

Row text is `#F7E9C2` when selected, `#B08A3C` otherwise; hover → `#FFF6D8`. Once a pour has
begun every row is `disabled`, `cursor: not-allowed`, and unselected rows drop to
`opacity: .28` — the tier is fixed the moment the stream opens.

"Reach" is computed, not authored: it is the best rarity the tier can attain under a perfect
15-second pour (`reachableRarity(tierIndex)`). It exists so `Sample` doesn't read as a broken
version of `Full Pour` — every tier states its own ceiling honestly.

**Now-pouring block.** Flex column, `gap: 14px`, `padding-bottom: 22px`,
`border-bottom: 1px solid rgba(201,146,46,.24)`.
- Label, 11px / `3.2px` / uppercase / `#B08A3C`, phase-dependent:
  `Selected for disbursement` → `Now pouring` → `Poured · awaiting seal`.
- Name and price on one baseline-aligned row, both Bodoni Moda
  `clamp(30px, 3.4vw, 42px)` / `line-height: .92`; name `#F7E9C2`, price `#C9922E` tabular.
- Note, Bodoni Moda italic 17px, `line-height: 1.45`, `#8A6A2A`, `text-wrap: pretty`.

**Spec sheet** (toggleable). Four rows, `gap: 15px`, each
`grid-template-columns: 104px 1fr 62px`, `align-items: center`, `gap: 12px`:
- Label — 11px, `letter-spacing: 2.2px`, uppercase, `#B08A3C`.
- Track — `height: 6px`,
  `repeating-linear-gradient(90deg, rgba(201,146,46,.22) 0 1px, transparent 1px 7px)`;
  fill is absolutely positioned `top:2px; bottom:2px`,
  `linear-gradient(90deg, #B08A3C, #F5D67A)`,
  `box-shadow: 0 0 12px rgba(245,214,122,.45)`.
- Value — 11px, `letter-spacing: 1.2px`, `#B08A3C`, tabular, right-aligned.

Rows are **Fill, Force, Commitment, Steadiness** — the four components of the rarity score,
in weight order. Bar width is that component's permille ÷ 10.

**Classification bar.** Label row `Classification` / `{score} / 1000` (score in the live
accent). Track `height: 8px`, `rgba(201,146,46,.1)`; fill
`linear-gradient(90deg, #B08A3C, <live accent>)`,
`box-shadow: 0 0 14px rgba(245,214,122,.4)`. Three threshold ticks overhang the track by 3px
top and bottom, `1px` wide, `rgba(201,146,46,.55)`, at **53.3%**, **66.5%**, **77.1%** —
these are the thresholds 533 / 665 / 771 expressed as percentages and must be derived from
the constants, not hard-coded twice. Beneath: `Common Uncommon Rare Singular`, space-between,
11px, `letter-spacing: 1.4px`, uppercase, `#8A6A2A`.

**Notice band** (conditional). `padding: 12px 0`, rules top and bottom
`1px solid rgba(245,214,122,.5)`. Heading `Notice`, 11px, `letter-spacing: 2.8px`, uppercase,
`#F5D67A`; body 12px, `letter-spacing: 1.2px`, `#B08A3C`, `text-wrap: pretty`. Carries the
WebGL-unavailable message, the mint failure message, and the hard-stop message.

**Action row.** Flex, `gap: 12px`.
- Primary: `flex: 1`, `padding: 17px 12px`, 11px, `letter-spacing: 3px`, uppercase, plus an
  inner hairline frame at `inset: 3px`. Enabled → background `rgba(201,146,46,.16)`, border
  `rgba(201,146,46,.55)`, inner `rgba(201,146,46,.22)`, text `#F7E9C2`. Disabled →
  transparent, border `rgba(201,146,46,.18)`, inner transparent, text `#8A6A2A`.
  `transition: background .3s, border-color .3s, color .3s`.
  Label tracks phase: `Complete disbursement` → `Stream open` → `Settling…` →
  `Complete disbursement · {Rarity}` → `Disbursing…`. Only enabled when settled.
- Secondary `Discard`, shown only once poured: `padding: 17px 20px`, transparent,
  `border: 1px solid rgba(201,146,46,.18)`, `#8A6A2A`, 11px, `letter-spacing: 2.4px`.

#### Footer

Flex, wrap, space-between, `margin-top: 26px`, `padding: 14px 0 18px`,
`border-top: 1px solid rgba(201,146,46,.16)`, 11px, `letter-spacing: 2.4px`, uppercase,
`#8A6A2A`. Left: `All pours final · gratitude non-transferable`. Right, contextual:
`↑ ↓ traverse tiers · hold the vessel to pour`, or `Release to settle · discard to begin
again` once poured, or `All disbursements are irreversible` on other views.

---

### 2. The collection

**Purpose.** Browse prior disbursements; open any one as a certificate.

Header row: `Disbursements on record` / `{total} rendered irrecoverable`, 11px,
`letter-spacing: 3.2px`, uppercase, `#B08A3C`, `padding-bottom: 10px`,
`border-bottom: 1px solid rgba(201,146,46,.24)`.

**Grid.** `repeat(auto-fill, minmax(210px, 1fr))` at ≥900px, `minmax(150px, 1fr)` below.
Gap `clamp(14px, 1.6vw, 22px)`.

**Tile.** `padding: 14px`, background `#160B1A`,
`border: 1px solid rgba(201,146,46,.2)`, hover `#F5D67A`, flex column, `gap: 10px`. The
most recent record, when it is the one being viewed, gets its rarity accent as border color.
- Top row: index `01` and `№1,284`, 11px, `letter-spacing: 1.8px`, `#8A6A2A`, tabular.
- Sigil, `aspect-ratio: 1/1`, full width.
- Bottom row: rarity — 11px, `letter-spacing: 2.4px`, uppercase, in the rarity's **secondary**
  color — and price, Bodoni Moda 16px, `#C9922E`, tabular.

**Empty state.** `padding: 90px 20px`, centered, `gap: 16px`: a 44px square,
`border: 1px solid rgba(201,146,46,.3)`, filled with
`repeating-linear-gradient(135deg, transparent 0 5px, rgba(201,146,46,.14) 5px 6px)`; then
`The register is open and empty` (11px, `letter-spacing: 3.2px`, uppercase, `#B08A3C`); then
`nothing has yet been given for nothing` (Bodoni Moda italic 22px, `#8A6A2A`).

---

### 3. The certificate

**Purpose.** Display and print the sealed record.

**Toolbar** (screen only). Space-between, 11px, `letter-spacing: 2.6px`, uppercase,
`#B08A3C`, `padding-bottom: 10px`, `border-bottom: 1px solid rgba(201,146,46,.24)`.
Left: `A4 · 794 × 1123 · shown at {n} %`. Right: two text buttons in `#C9A24A` —
`View at 100 %` / `Fit to page`, and `Print`.

**The sheet is print geometry and must not reflow.** It is always laid out at exactly
**794 × 1123 px** and CSS-scaled to fit. The scale wrapper takes
`transform: scale(s); transform-origin: top left`; its parent is sized to the *scaled*
dimensions (`794s × 1123s`) with `overflow: hidden` in fit mode, and to the measured column
width with `overflow: auto` at 100%.

`s` is computed from the **actual measured width of the container**, via `ResizeObserver` on
the wrapper's parent. Do not derive it from the viewport or from another element's width — an
earlier iteration borrowed a different element's measurement, came out ~21px wide, and
clipped the sheet's right-hand rule off the page.

**Sheet composition.** Same radial ground as the app but on the certificate's own stops:
`radial-gradient(115% 70% at 50% -10%, #2A1136 0%, #1A0E1E 48%, #120A15 100%)`.
Grain at `opacity: .14`. Vignette `inset 0 0 120px 40px rgba(10,6,13,.55)`.
Double rule at `inset: 26px` (`rgba(201,146,46,.5)`) and `inset: 33px`
(`rgba(201,146,46,.24)`). Four 15px corner ticks at inset 40px,
`rgba(245,214,122,.7)`. Content padding `52px 62px 46px`.

- **Header** — `Molten Pour · Office of Disbursement` and the serial; 12px,
  `letter-spacing: 2.6px`, uppercase, in the rarity secondary;
  `border-bottom: 1px solid rgba(201,146,46,.28)`, `padding-bottom: 14px`.
- **Title block** — `CERTIFICATE OF WASTE`, Bodoni Moda 400, 34px, `letter-spacing: 8px`
  with matching `text-indent: 8px` (so the tracked line stays optically centered), `#F7E9C2`,
  `text-shadow: 0 0 40px rgba(201,146,46,.3)`. Subtitle
  `Issued upon irreversible disbursement`, 12px, `letter-spacing: 3.4px`, uppercase,
  `#B08A3C`. Then a 290px rule–motto–rule lockup: `non revertitur`, Bodoni Moda italic 17px,
  `letter-spacing: 2px`, in the rarity accent, flanked by gradient hairlines fading to
  transparent outward.
- **Sigil** — centered in the remaining flexible space, `max-width: 300px`.
- **Caption** — `Pour №1,284 · Rare · Alloy`, 12px, `letter-spacing: 3px`, uppercase,
  rarity secondary.
- **Data table** — a `<dl>` of eight rows. Each: `dt` 12px / `letter-spacing: 2.4px` /
  uppercase / rarity secondary; a dashed leader
  (`repeating-linear-gradient(90deg, rgba(201,146,46,.3) 0 1px, transparent 1px 5px)`,
  `aria-hidden`); `dd` Bodoni Moda 17px, tabular, rarity accent. Row padding `5px 2px 4px`,
  `border-bottom: 1px solid rgba(201,146,46,.2)`. Rows: Serial · Ledger position · Substance ·
  Classification (`Rare · 712`) · Mass rendered irrecoverable · Batch · Consideration · Issued.
- **Motto** — `for nothing`, Bodoni Moda italic 22px, `letter-spacing: 1.5px`, `#F7E9C2`,
  `padding: 16px 0 14px`.
- **Footer** — `This instrument confers no right, claim, or residual value.` (max-width 70%)
  and `rev. vii — mmxxvi`; `border-top: 1px solid rgba(201,146,46,.28)`, 12px,
  `letter-spacing: 1.9px`, uppercase, `#B08A3C`.

**Print rules.** `@page { size: A4 portrait; margin: 0 }`. On print: hide everything marked
as app chrome, set `visibility: hidden` on all descendants and back to `visible` on the sheet
subtree, pin the sheet wrapper to `position: absolute; left: 0; top: 0` at its true
`794 × 1123`, force `overflow: visible`, clear the scale transform, and set
`print-color-adjust: exact` plus `break-inside: avoid` on the page.

---

## The WebGL metaball rig

The centerpiece. A single full-screen triangle; all shape comes from the fragment shader.

**Geometry.** One `gl.TRIANGLES` draw of 3 vertices, `[-1,-1, 3,-1, -1,3]`. Vertex shader is
a pass-through.

**Uniforms.** `u_res` (vec2), `u_pos[32]` (vec2 array), `u_rad[32]` (float array),
`u_iridescence` (float), `u_roughness` (float). `MAX_BLOBS = 32` is compiled into the shader
via template literal — it must match the JS arrays exactly.

**Field function.** Classic metaball sum, `f += r² / max(dot(d,d), 1.0)`, skipping any blob
whose radius is ≤ 0 (the free-slot marker). Surface is `smoothstep(0.85, 1.15, f)`.

**Shading.** Normals from central differences of the field with `e = 1.5`, packed as
`normalize(vec3(-dx, dy, 1.6))`. Blinn–Phong with `L = normalize(vec3(-0.45, 0.75, 0.55))`,
`V = (0,0,1)`; shininess `mix(12, 320, 1 - u_roughness)`; Fresnel `pow(1 - ndv, 3)`.
Palette ramp: `BRONZE → BODY` by `ndl`, toward `HOT` by `ndl² × 0.7`, toward `SPEC` by
specular, toward `HOT` again by `fres × 0.5`, then toward a thin-film rainbow by
`u_iridescence × fres × 0.85`. Thin film is three phase-shifted sines
(`0`, `2.09`, `4.19`) of `(1 - ndv) × 9`.

Shader constants (linear RGB, matching the palette):
`VOID (0.086, 0.043, 0.102)` · `BRONZE (0.239, 0.141, 0.063)` · `BODY (0.788, 0.573, 0.180)`
· `HOT (0.961, 0.839, 0.478)` · `SPEC (1.000, 0.965, 0.847)`.

Off-surface pixels aren't discarded — they get a bronze bloom of
`smoothstep(0.10, 0.9, f) × 0.42`, so the fluid glows through the void. A vignette
(`smoothstep(1.15, 0.30, …) × 1.55`) multiplies both paths, and a hash dither of
`±1/440` is added everywhere to kill banding in the large dark gradients.

**Simulation.** `scale = H / 900` normalizes to device pixels. Spawn at `x = W/2` (± 28·scale
jitter, plus lean × W × 0.16), `y = H × 0.20`; floor at `y = H × 0.82`. Gravity
`1400 · scale`. Horizontal drag `(1 - viscosity × 0.55)^(dt × 8)`. On floor contact: clamp y,
invert vy by `0.28 × (1 - viscosity)`, damp vx by `1 - viscosity × 0.7`, shrink radius by
`1 - 0.12 × viscosity`. Blobs are freed when they leave the sides by 80px or shrink below
`4 · scale`. The slot array is a **ring buffer** — `cursor = (cursor + 1) % 32`.

**Tier feel** is five numbers per tier — `viscosity`, `iridescence`, `roughness`, `flow`,
`radius` — each eased toward its target every frame at `k = min(1, dt × 4.5)`, so changing
tier visibly *thickens or thins* the fluid rather than cutting.

| # | Tier | Consideration | Visc | Irid | Rough | Flow | Radius |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Sample | Free | .15 | 0 | .75 | 10 | 16 |
| 02 | Measure | $2.99 | .45 | 0 | .40 | 16 | 22 |
| 03 | Draught | $9.99 | .60 | .10 | .30 | 20 | 26 |
| 04 | Vessel | $24.99 | .72 | .25 | .12 | 24 | 30 |
| 05 | Crucible | $49.99 | .82 | .75 | .06 | 28 | 34 |
| 06 | Full Pour | $99.99 | .92 | 1 | .03 | 34 | 40 |

`flow` is shared with the repo's `tiers.ts` and is **also the telemetry spawn rate** — see below.

**Resize.** `ResizeObserver` on the canvas; back the buffer at
`min(devicePixelRatio, 2)`, set `canvas.width/height` and `gl.viewport` together.

**Context lifecycle.** The canvas mounts and unmounts as the user moves between views, so
GL setup must be driven by a **callback ref** that initializes on attach and tears down
(cancel the RAF, disconnect the observer, drop the context) on detach. A `useEffect` keyed on
mount is not sufficient here — an earlier structure leaked a live RAF against a dead context.

### The telemetry tap — read this before touching the loop

Two invariants keep the client's numbers acceptable to `clampTelemetry` and to the Go API.
Violating either produces a pour that silently gets clamped and reported as tampered.

**1. Spawn at exactly the tier's flow rate.** `spawnAcc += dt × tier.flow`, no multiplier.
The clamp permits `ceil(flow × seconds × 1.15)` landings; spawning at exactly `flow`
guarantees landings can never exceed it. (The reference prototype this design is based on
spawned at `flow × 1.1` for looks — that number must not survive into a build that reports
telemetry.)

**2. Record velocity in sim units, not device pixels.** The loop integrates in device pixels
(`gravity × scale`), but peak velocity is compared against a scale-free ceiling. Divide by
`scale` at the moment of sampling. Otherwise a retina display inflates every pour past the
clamp and the record comes back flagged.

Also: sample peak velocity only from blobs that have **not yet landed** (post-bounce
velocities are meaningless), count a landing exactly once via a per-slot `landed` flag, and
reset that flag on slot reuse.

`tiltEnergy` accumulates `min(|lean|, 1) × maxTiltRate × dt` while pouring, where `lean` is
∈[-1, 1] from pointer x within the stage, or from `deviceorientation.gamma / 45` on mobile.

**Settling** is the absence of airborne blobs: once the stream closes and no unlanded blob
remains, the phase advances to `settled`.

### Painting the readout without re-rendering

Telemetry changes every frame; React must not. The loop accumulates ~100ms and then writes
**directly to DOM nodes through refs** — bar widths via `style.width`, values and labels via
`textContent`, each guarded by an equality check. `setState` is called only on genuine
transitions: phase changes, and rarity band changes (which recolor the accent). Keep this
split; driving the bars through state will make the pour stutter.

---

## Interactions & behavior

**Pouring.** `pointerdown` on the stage opens the stream (capture the pointer so a drag
outside still tracks); `pointerup`, `pointerleave`, `pointercancel` close it. `Space` or
`Enter` on the focused stage does the same, with `preventDefault` on keydown. `pointermove`
while open sets lean.

**Tier navigation.** `ArrowUp` / `ArrowDown` cycle tiers, wrapping, and only while idle.
Handler is on `window`; it should no-op unless the ceremony view is showing.

**The phase sequence.**

```
idle ──pointerdown──> pouring ──release──> settling ──last drop lands──> settled
  ^                       │                                                 │
  │                       └── 15s hard stop ── auto-close ─────────────────>│
  │                                                                         │
  └────────────── discard ──────────┬──────────── mint ────> sealing ──> certificate
                                    └────────────────────────────────────────┘
```

- `idle` — tiers selectable, primary action disabled.
- `pouring` — tier locks, stage border brightens over `.4s`, telemetry accumulates.
- `settling` — stream closed, drops still falling; primary reads `Settling…`.
- `settled` — primary enables and names the achieved rarity.
- `sealing` — a fixed full-page overlay at `rgba(10,6,13,.94)`: `Sealing the record`
  (11px, `letter-spacing: 4.5px`, uppercase, `#B08A3C`), a 230px hairline whose `#F5D67A`
  fill animates `mp-seal 1.3s linear`, and `non revertitur` in Bodoni Moda italic 26px,
  `#F7E9C2`. Both text elements enter on `mp-rise .6s ease-out`. Holds **1400ms**, then
  mints and navigates to the certificate. Reduced-motion setting shortens this to 260ms.
- Hard stop at 15000ms closes the stream automatically and posts the notice
  `Hard stop reached at fifteen seconds. The vessel accepts no more.`

**Keyframes.**
- `breathe` — `2.6s ease-in-out infinite`; `0%/100% { opacity: .3; transform: scale(1) }`,
  `50% { opacity: .85; transform: scale(1.35) }`.
- `mp-seal` — `width: 0 → 100%`.
- `mp-rise` — `opacity 0→1`, `translateY(8px)→0`.

**Transitions.** Tier marker `transform .45s cubic-bezier(.22,1,.36,1)`. Stage border
`.4s linear`. Primary action `background .3s, border-color .3s, color .3s`. Tier row text
`color .2s`, opacity `.3s`.

**Focus.** `:focus-visible { outline: 1px solid #F5D67A; outline-offset: 3px }`. Nothing in
this design has a border radius — buttons, inputs, and fieldsets are explicitly reset to
`border-radius: 0`.

**Error states.** WebGL unavailable → the notice band reads *The vessel could not be lit —
WebGL is unavailable in this context.* and the rest of the ceremony stays usable. A mint
failure surfaces its message in the same band and returns the user to `settled` so they can
retry rather than losing the pour.

---

## State management

| State | Type | Notes |
| --- | --- | --- |
| `view` | `'ceremony' \| 'collection' \| 'certificate'` | |
| `idx` | `number` | Selected tier; frozen once poured |
| `phase` | `'idle' \| 'pouring' \| 'settling' \| 'settled'` | |
| `rarity` | rarity name | Live band; drives every accent |
| `sealing` | `boolean` | Drives the overlay |
| `pours` | `Record[]` | Newest first |
| `current` | `Record \| null` | Sheet being viewed |
| `notice` | `string \| null` | |
| `wide` | `boolean` | `innerWidth >= 900` |
| `zoom` | `'fit' \| 'full'` | |
| `sheetW` | `number` | Measured; drives sheet scale |

**Deliberately outside React state** (mutable refs, written every frame): the live telemetry
accumulator (`holdMs`, `dropletsLanded`, `peakVelocity`, `tiltEnergy`), the `pouring` flag,
`lean`, `startedAt`, and the eased shader parameters. These change at 60Hz and must never
trigger a render.

**Data.** The prototype seeds a deterministic ledger from a fixed RNG so the collection is
never empty in review. In production, load real records; `startedAt` is captured at first
pointer-down and becomes the record's `timestampMs`, which is part of the hash — so it must
be the pour's real start, not the mint time. The ledger position (`1284` in the prototype) is
assigned by the server.

---

## Design tokens

**Color**

| Token | Hex | Use |
| --- | --- | --- |
| Void | `#0C070F` | Page base |
| Plum | `#2A1136` | Radial top stop |
| Plum mid | `#170D1C` | Radial mid stop |
| Plum deep | `#0A060D` | Radial outer stop |
| Panel | `#160B1A` | Stage, tiles |
| Cream | `#F7E9C2` | Display type, active text |
| Hot gold | `#F5D67A` | Active rule, marker, focus |
| Body gold | `#C9A24A` | Default text |
| Bronze | `#C9922E` | Prices, links |
| Label | `#B08A3C` | Instrument labels |
| Faint | `#8A6A2A` | Tertiary, footer |
| Spec white | `#FFF6D8` | Hover, Rare accent |

Rule opacities are all `#C9A24A` (`rgba(201,146,46,·)`) at `.055` (column grid), `.1`
(row rules), `.14` (rail), `.18` (disabled border), `.2` (table rows), `.22` (stage border),
`.24` (section rules), `.28` (sheet rules), `.35` (leaders), `.5` / `.55` (sheet outer rule,
enabled border). Hot-gold ticks are `rgba(245,214,122,.6)`–`.72`.

**Rarity accents** — accent / secondary / substance:

| Rarity | Accent | Secondary | Substance |
| --- | --- | --- | --- |
| Common | `#D8BC7E` | `#B08A3E` | Brass |
| Uncommon | `#F5D67A` | `#C9922E` | Gold |
| Rare | `#FFF6D8` | `#E8C260` | Alloy |
| Singular | `#E8BCF2` | `#C97AD8` | Living Metal |

Singular is the only place violet appears in the type system — it is the payoff for the plum
ground running under everything else.

**Type.** Two families only.
- `ui-monospace, 'SF Mono', Menlo, monospace` — every label, control, and datum.
- `'Bodoni Moda', serif` — display, prices, table values, mottos. Self-hosted (woff2, 400
  and 400 italic) at `app/certificate/fonts/`; **keep it self-hosted** — the repo notes this
  is deliberate, and the certificate must render identically offline and in print.

Scale: 11px instrument labels (uppercase, `letter-spacing` 1.2–4.5px) · 12px sheet labels and
notice body · 16–17px Bodoni values · 22px mottos · 26px sealing motto · 34px sheet title ·
`clamp(30px, 3.4vw, 42px)` now-pouring · `clamp(38px, 5.2vw, 62px)` page title.

All numeric readouts use `font-variant-numeric: tabular-nums` — non-negotiable, since these
values update ten times a second and must not reflow.

**Spacing.** Fluid at the page level (`clamp(16px,3vw,34px)` inset,
`clamp(26px,3vw,44px)` main gap, `clamp(14px,1.6vw,22px)` tile gap); fixed inside components
(52px tier row, 26px rail gap, 24px ledger stack, 15px spec rows, 12px control gap).

**Radius.** None. Anywhere. `border-radius: 0` is asserted on form elements; the only
exception is the 14px status dot ring, which is a circle by definition.

**Shadow.** Stage `0 0 120px 10px rgba(201,146,46,.09), inset 0 0 0 1px rgba(12,7,15,.9)` ·
stage vignette `inset 0 0 100px 34px rgba(10,6,13,.8)` · sheet vignette
`inset 0 0 120px 40px rgba(10,6,13,.55)` · marker `-2px 0 22px rgba(245,214,122,.25)` ·
spec fill `0 0 12px rgba(245,214,122,.45)` · score fill `0 0 14px rgba(245,214,122,.4)` ·
display type `0 0 44px rgba(201,146,46,.35)`, sheet title `0 0 40px rgba(201,146,46,.3)`.

---

## Responsive behavior

The breakpoint is **900px**, held in one place and read as a boolean.

Above it: folio rail visible, two-column main, stage
`min(70vh, 720px, (100vw - 720px) * 1.7778)`, tiles at 210px minimum.

Below it: rail hidden, everything stacks to one column (vessel above ledger), stage
`min(58vh, 520px)`, tiles at 150px minimum. Header, nav, and footer already wrap.

The design was drawn mobile-first for touch — the stage is a large hold target, and the
44px+ tap-target floor is respected by the 52px tier rows and 17px-padded actions. The
graduations column stays at all widths; it is part of the instrument, not decoration.

Certificate: the sheet never reflows at any width — only the fit scale changes.

---

## Accessibility

- Stage: `role="button"`, `tabindex="0"`, `aria-label="Hold to pour"`, full keyboard parity.
- Notice band is `role="alert"`.
- Every decorative layer (grain, vignette, ticks, leaders, callouts, marker) is
  `pointer-events: none` and, where it is a text-bearing leader inside a `<dl>`,
  `aria-hidden="true"`.
- Certificate data is a real `<dl>` / `<dt>` / `<dd>`, so it survives as structured text.
- Focus ring is a single hairline in hot gold at 3px offset — visible against the plum ground
  without breaking the register.
- The `breathe` and `mp-seal` animations are the only continuous motion; honor
  `prefers-reduced-motion` by stilling the status dot and taking the 260ms seal path.

---

## Assets

- **Bodoni Moda** woff2, weights 400 and 400 italic, self-hosted — already in the repo at
  `app/certificate/fonts/`, with `bodoni.css` declaring the faces. Nothing new to source.
- **Grain** is an inline SVG `feTurbulence` data URI, not an image file.
- **Sigils** are generated at runtime from the seed — no assets.
- No icons, no imagery, no logos. Every mark on screen is type, rule, or generated geometry.

---

## Files

| File | What it is |
| --- | --- |
| `Molten Pour Index.dc.html` | The redesign. All three views, the WebGL rig, the shader, the full simulation and scoring port. Open directly in a browser. |
| `github.md` | Repo linkage and the screen → source-file map. |

Reference sources in `EPW80/moltenpour@main`: `app/ceremony/`, `app/sigil/`,
`app/certificate/`, `app/collection/`, `app/pour/record.ts`, `api/pour/pour.go`, and the
original design handoff at `docs/handoffs/certificate-of-waste/`.
