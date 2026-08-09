/**
 * tokens.ts — the specimen-ledger palette
 *
 * Lifted from the token table in docs/handoffs/certificate-of-waste/README.md.
 * These values are final: the certificate is print-exact and the app shares its
 * typographic voice.
 *
 * CONTRAST, and where the index redesign departs from it:
 *
 * Everything down to GOLD_LABEL clears 4.5:1 against the plum ground — GOLD_LABEL
 * is ~5.7:1 and the Singular secondary ~6.3:1, the two closest to the line. The
 * certificate holds that floor absolutely: nothing below #A07E3A prints as text.
 *
 * GOLD_FAINT (#8A6A2A) is the exception and is app-chrome only. It measures
 * ~3.8:1 on the mid plum stop and ~4.0:1 on the outer, so it is under AA for
 * small text. It comes from the index handoff, where it carries the tertiary
 * register — footer, graduations, tier index and reach, inactive tabs. It is a
 * known, accepted departure rather than an oversight; raising it to #A07E3A is a
 * one-line change here if the register can afford it. Never use it on the sheet.
 */

export const COLOR = {
  voidPlum: "#2A1136",
  plum: "#1A0E1E",
  voidDeep: "#120A15",

  /** The app's own base and its darkest radial stops. Never pure black. */
  void: "#0C070F",
  plumMid: "#170D1C",
  plumDeep: "#0A060D",
  /** Stage and collection tiles: one step up from the ground, not a card. */
  panel: "#160B1A",

  goldCream: "#F7E9C2",
  goldHot: "#F5D67A",
  goldBody: "#C9A24A",
  goldLabel: "#B08A3C",
  /** Prices and links. */
  bronze: "#C9922E",
  /** Tertiary. App chrome only — see the contrast note above. */
  goldFaint: "#8A6A2A",
  /** Hover, and the Rare accent. */
  specWhite: "#FFF6D8",

  ruleStrong: "rgba(201,146,46,.5)",
  ruleEnabled: "rgba(201,146,46,.55)",
  rule: "rgba(201,146,46,.28)",
  ruleMid: "rgba(201,146,46,.24)",
  ruleStage: "rgba(201,146,46,.22)",
  ruleRow: "rgba(201,146,46,.2)",
  ruleDisabled: "rgba(201,146,46,.18)",
  ruleFooter: "rgba(201,146,46,.16)",
  ruleRail: "rgba(201,146,46,.14)",
  ruleHair: "rgba(201,146,46,.1)",
  /** The 96px column rule that gives the index its ledger-paper ground. */
  ruleColumn: "rgba(201,146,46,.055)",
  leader: "rgba(201,146,46,.3)",
  tick: "rgba(245,214,122,.7)",
  tickStage: "rgba(245,214,122,.6)",
  shade: "rgba(10,6,13,.55)",
} as const;

/**
 * The certificate's ground. Its stops are print-tuned and separate from the
 * app's on purpose — the sheet is a document, not a screen.
 */
export const PAGE_GROUND =
  "radial-gradient(115% 70% at 50% -10%, #2A1136 0%, #1A0E1E 48%, #120A15 100%)";

/** The index ground. Deeper and taller than the sheet's, and never printed. */
export const APP_GROUND =
  "radial-gradient(115% 75% at 50% -12%, #2A1136 0%, #170D1C 46%, #0A060D 100%)";

/** The hairline column grid laid over the app ground at opacity .5. */
export const COLUMN_RULE = `repeating-linear-gradient(90deg, ${COLOR.ruleColumn} 0 1px, transparent 1px 96px)`;

/** The dashed leader that runs between a label and its value. */
export const LEADER_RULE = `repeating-linear-gradient(90deg, ${COLOR.leader} 0 1px, transparent 1px 5px)`;

/** Procedural, so there is no image asset to ship or fail to load. */
export const GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>\")";

export const FONT = {
  /** Display face. Self-hosted for the PDF path — see app/certificate/fonts. */
  display: "'Bodoni Moda', serif",
  /** Instrument labels. 12px floor, never smaller. */
  instrument: "ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

/**
 * The certificate's label floor. A legibility decision, not a style one, and the
 * sheet does not go under it.
 *
 * The app chrome sets its instrument labels at 11px, per the index handoff,
 * where the tighter scale is what makes the ledger read as an instrument. That
 * is the same accepted departure as GOLD_FAINT above and applies to screen only.
 */
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
  Common: { accent: "#D8BC7E", secondary: "#B08A3E", substance: "Brass" },
  Uncommon: { accent: "#F5D67A", secondary: "#C9922E", substance: "Gold" },
  Rare: { accent: "#FFF6D8", secondary: "#E8C260", substance: "Alloy" },
  Singular: {
    accent: "#E8BCF2",
    secondary: "#C97AD8",
    substance: "Living Metal",
  },
} as const;
