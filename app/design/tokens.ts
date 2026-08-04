/**
 * tokens.ts — the specimen-ledger palette
 *
 * Lifted from the token table in docs/handoffs/certificate-of-waste/README.md.
 * These values are final: the certificate is print-exact and the app shares its
 * typographic voice.
 *
 * IMPORTANT: nothing below #A07E3A is allowed for text at any size. Every text
 * colour here clears 4.5:1 against the plum ground — GOLD_LABEL is ~5.7:1 and the
 * Singular secondary ~6.3:1, which are the two closest to the line.
 */

export const COLOR = {
  voidPlum: '#2A1136',
  plum: '#1A0E1E',
  voidDeep: '#120A15',

  goldCream: '#F7E9C2',
  goldHot: '#F5D67A',
  goldBody: '#C9A24A',
  goldLabel: '#B08A3C',

  ruleStrong: 'rgba(201,146,46,.5)',
  rule: 'rgba(201,146,46,.28)',
  ruleMid: 'rgba(201,146,46,.24)',
  ruleRow: 'rgba(201,146,46,.2)',
  leader: 'rgba(201,146,46,.3)',
  tick: 'rgba(245,214,122,.7)',
  shade: 'rgba(10,6,13,.55)',
} as const;

export const PAGE_GROUND =
  'radial-gradient(115% 70% at 50% -10%, #2A1136 0%, #1A0E1E 48%, #120A15 100%)';

/** Procedural, so there is no image asset to ship or fail to load. */
export const GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>\")";

export const FONT = {
  /** Display face. Self-hosted for the PDF path — see app/certificate/fonts. */
  display: "'Bodoni Moda', serif",
  /** Instrument labels. 12px floor, never smaller. */
  instrument: "ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/** The 12px floor is a legibility decision, not a style one. Do not go under it. */
export const INSTRUMENT_MIN_PX = 12;

/**
 * Per-rarity presentation. Accent drives table values, the motto and the sigil
 * pool core; secondary drives every label, the header strip, the caption, the
 * sigil satellites and tendrils, and the footer folio.
 *
 * IMPORTANT: Common is roughly 55% of all certificates and must not read as a
 * consolation prize. Layout, rule weights, glow and type are identical across
 * rarities — only this pair and the substance string change. Do not add badges or
 * extra ornament for the high rarities.
 */
export const RARITY_PRESENTATION = {
  Common: { accent: '#D8BC7E', secondary: '#B08A3E', substance: 'Brass' },
  Uncommon: { accent: '#F5D67A', secondary: '#C9922E', substance: 'Gold' },
  Rare: { accent: '#FFF6D8', secondary: '#E8C260', substance: 'Alloy' },
  Singular: { accent: '#E8BCF2', secondary: '#C97AD8', substance: 'Living Metal' },
} as const;
