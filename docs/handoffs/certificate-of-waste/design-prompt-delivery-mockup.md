# Claude Design prompt — post-purchase delivery mockup

Paste everything below the line. Values are pulled from the actual build so the
mockup matches what ships rather than a parallel invention.

---

Design a single presentation board titled **"What you receive"** showing the three
artifacts a user gets after one purchase in MoltenPour, a mobile app where you pay
to pour molten metal down the screen and keep the splatter it leaves.

Board: 2400 × 1400, dark. Three panels left to right, generous gutters, one shared
caption strip along the bottom.

## Palette — use these exact values, no substitutions

Background `#1A0E1E` (dark plum, never pure black)
Frame / rules `#4A2456`
Body gold `#C9922E`
Hot gold `#F5D67A`
Specular `#FFF6D8`
Rarity accent (this board shows a **Singular**, the rarest tier): `#E8BCF2`
with `#C97AD8` for secondary labels

Every text element must clear 4.5:1 contrast against the background. Do not
use anything below `#A07E3A` for text at any size.

## Panel 1 — The sigil

A generative splatter artifact rendered as line-and-fill vector art on the plum
background: an irregular 12-lobed central pool, roughly 26 small satellite droplets
scattered evenly around it, and 9 straight tendrils radiating outward from the pool
edge at varied lengths and stroke weights. Radial gradient from `#E8BCF2` at center
to `#1A0E1E` at the rim. Satellites and tendrils in `#C97AD8`.

Even, near-symmetrical satellite spacing — this one was a steady pour. Caption
beneath: `POUR №1,284 · SINGULAR · LIVING METAL`.

## Panel 2 — The Certificate of Waste

A portrait document, ISO 216 ratio (1:1.414), double-ruled border in `#7A3A8C`.
Serif throughout — Times or similar. Register is deadpan institutional: this is a
bank document about something idiotic, and it never winks.

- Title, letterspaced wide: `CERTIFICATE OF WASTE`
- Subtitle: `ISSUED UPON IRREVERSIBLE DISBURSEMENT`
- Italic Latin motto: `NON REVERTITUR`
- The sigil from Panel 1, centered, filling the upper half
- A two-column table, label left in `#C97AD8`, value right in `#E8BCF2`, hairline
  rule under each row:

  | | |
  |---|---|
  | SERIAL | MP-0001284-6AE8 |
  | LEDGER POSITION | No. 1,284 |
  | SUBSTANCE | Living Metal |
  | CLASSIFICATION | Singular |
  | MASS RENDERED IRRECOVERABLE | 310.97 g |
  | BATCH | 277-T |
  | CONSIDERATION | USD 99.99 |
  | ISSUED | 2026-08-02 |

- Centered italic inscription near the base: `FOR NOTHING`
- Footer, clearly legible, not decorative:
  `THIS INSTRUMENT CONFERS NO RIGHT, CLAIM, OR RESIDUAL VALUE.`

## Panel 3 — The collection entry

A phone frame, 9:16, showing the gallery: a 2-column grid of sigil thumbnails on
the plum background. Eight tiles. Seven are muted warm golds and bronzes; the
eighth — top left, freshly minted — is the magenta Singular with a thin
`#E8BCF2` border and its ordinal `№1,284` beneath.

Above the grid, a quiet header row: `YOUR POURS · 8` and a total `USD 214.93`.
Small monospace, `#C97AD8`, no emphasis. Restraint here is the point.

## Caption strip

Three short labels under the panels, small letterspaced caps in `#C97AD8`:
`THE ARTIFACT` · `THE CERTIFICATE` · `THE COLLECTION`

## Hard constraints

- No banknotes, no coins that resemble real currency, no dollar-sign iconography.
  Reproducing US currency imagery has legal restrictions; the product uses abstract
  metal only.
- No emoji, no exclamation marks, no celebratory copy. No "Congratulations!",
  no confetti, no burst graphics.
- No mystery boxes, wrapped gifts, spinning wheels, chests, or any UI that implies
  a randomized outcome. Rarity here is earned from how the user poured, and the
  mockup must not suggest otherwise.
- No fire, flames, or embers. The substance is liquid metal, not burning money.
- Do not add a "Buy again" or "Pour again" call to action anywhere.

## Register

Restrained, institutional, faintly funereal. The comedy comes from treating a
frivolous purchase with total bureaucratic seriousness — so the design itself must
play it completely straight. If a choice feels playful, it is wrong.

---

## Swap these to see other tiers

Replace the accent pair and the three tier strings:

| Rarity | Accent | Secondary | Substance | Consideration |
|---|---|---|---|---|
| Common | `#D8BC7E` | `#B08A3E` | Brass | Free |
| Uncommon | `#F5D67A` | `#C9922E` | Gold | USD 2.99 |
| Rare | `#FFF6D8` | `#E8C260` | Alloy | USD 24.99 |
| Singular | `#E8BCF2` | `#C97AD8` | Living Metal | USD 99.99 |

Worth generating the **Common** variant too. About 55% of all certificates will be
Common, so if that version looks like a consolation prize you have a retention
problem, not an art problem.
