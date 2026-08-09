/**
 * tiers.ts — what a pour costs and how fast it flows
 *
 * This is the TIERS that telemetry.ts refers to by name.
 *
 * IMPORTANT: `flow` is not redefined here. It is read from TIER_BOUNDS in
 * app/sigil/telemetry.ts, which is the half of the codebase that is ported to Go
 * and pinned by the corpus. The dependency points app → sigil and never back:
 * the ported core must stay free of app imports, so the app composes price and
 * copy on top of it rather than the core reaching up for them.
 *
 * A tier is what you BUY. It is not what you earn — see app/sigil/rarity.ts.
 */

import { clampTelemetry, SIM, TIER_BOUNDS } from "../sigil/telemetry";
import { classify, type Rarity } from "../sigil/rarity";

/** Prices, index-aligned with TIER_BOUNDS. Cents, never floats. */
const AMOUNT_CENTS = [0, 299, 999, 2499, 4999, 9999] as const;

/** The ceremony's own name for each tier. Distinct from a rarity name. */
const TIER_NAMES = [
  "Sample",
  "Measure",
  "Draught",
  "Vessel",
  "Crucible",
  "Full Pour",
] as const;

/** The line the ledger prints under the selected tier. Deadpan, never a pitch. */
const TIER_NOTES = [
  "Free of charge, free of merit. The house pours what it cannot sell.",
  "The minimum viable genuflection. Thin, but sincere in its way.",
  "Enough to be noticed by staff. Coats the glass on the way down.",
  "Gold-adjacent, legally distinct from gold. Nobody checks.",
  "Refracts your name in the light, briefly, at certain angles.",
  "Volume is the only remaining virtue. The vessel is a formality.",
] as const;

/**
 * How the fluid behaves and looks at each tier.
 *
 * Presentation only: none of it reaches the telemetry, the clamp or the hash, so
 * it has no Go counterpart and cannot move a rarity. The rig eases toward these
 * every frame rather than cutting, so changing tier visibly thickens or thins
 * what is in the vessel.
 */
export type TierFeel = {
  /** Drag, bounce damping and how much a blob shrinks on impact. */
  viscosity: number;
  /** Thin-film rainbow in the shader. Zero below Draught. */
  iridescence: number;
  /** Inverted into specular shininess. Low is glassy. */
  roughness: number;
  /** Blob radius in sim units before the per-blob jitter. */
  radius: number;
};

const TIER_FEEL: TierFeel[] = [
  { viscosity: 0.15, iridescence: 0, roughness: 0.75, radius: 16 },
  { viscosity: 0.45, iridescence: 0, roughness: 0.4, radius: 22 },
  { viscosity: 0.6, iridescence: 0.1, roughness: 0.3, radius: 26 },
  { viscosity: 0.72, iridescence: 0.25, roughness: 0.12, radius: 30 },
  { viscosity: 0.82, iridescence: 0.75, roughness: 0.06, radius: 34 },
  { viscosity: 0.92, iridescence: 1, roughness: 0.03, radius: 40 },
];

export type Tier = {
  index: number;
  name: string;
  /** Droplets spawned per second. The clamp derives its droplet ceiling from it. */
  flow: number;
  amountCents: number;
  note: string;
  feel: TierFeel;
};

export const TIERS: Tier[] = TIER_BOUNDS.map((bounds, index) => ({
  index,
  name: TIER_NAMES[index] ?? `Tier ${index}`,
  flow: bounds.flow,
  amountCents: AMOUNT_CENTS[index] ?? 0,
  note: TIER_NOTES[index] ?? "",
  feel: TIER_FEEL[index] ?? TIER_FEEL[0],
}));

export function tierAt(index: number): Tier {
  return TIERS[index] ?? TIERS[0];
}

/**
 * `USD 99.99`.
 *
 * IMPORTANT: plain text, never a currency glyph. The product brief forbids
 * dollar-sign iconography and anything resembling real currency — US currency
 * imagery carries legal restrictions, so the product uses abstract metal only.
 */
export function formatUSD(amountCents: number): string {
  return `USD ${(amountCents / 100).toFixed(2)}`;
}

/**
 * What a single tier costs: `USD 99.99`, or `Free` at zero.
 *
 * Only correct for a tier's own price. A running total of zero is `USD 0.00` —
 * a collection nobody has spent anything on has not been made free, it is empty.
 * Use formatUSD for sums.
 */
export function formatConsideration(amountCents: number): string {
  if (amountCents <= 0) return "Free";
  return formatUSD(amountCents);
}

/** The ceremony hard stop, re-exported so screens don't reach into SIM. */
export const MAX_POUR_MS = SIM.maxPourMs;

/**
 * The best classification a tier can reach, given a flawless pour.
 *
 * Rarity reach scales with what you paid, so the cheap tiers genuinely cannot
 * mint the rare classifications — a free pour is a Common in all but the most
 * perfect case. That is deliberate: it is what keeps the accepted-risk note in
 * telemetry.ts true, since a client claiming max-legal telemetry on every pour
 * still cannot reach Singular below tier 3.
 *
 * Showing it is the honest alternative to letting someone pour repeatedly on the
 * free tier wondering why the rare ones never come. Stating a ceiling is not
 * implying a random outcome — the brief forbids the latter, not the former.
 *
 * IMPORTANT: computed from the real clamp and the real classifier, never a
 * hardcoded table, so it cannot drift when the thresholds are re-tuned.
 */
export function reachableRarity(tierIndex: number): Rarity {
  // A flawless pour: every droplet the tier allows, terminal velocity, a
  // perfectly steady hand, held to the hard stop. 9e9 rather than Infinity —
  // the clamp zeroes non-finite input rather than treating it as "the maximum".
  const { telemetry } = clampTelemetry(
    {
      dropletsLanded: 9e9,
      peakVelocity: 9e9,
      tiltEnergy: 0,
      holdMs: SIM.maxPourMs,
    },
    tierIndex,
    SIM.maxPourMs,
  );
  return classify(telemetry, tierIndex);
}
