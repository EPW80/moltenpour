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

import { clampTelemetry, SIM, TIER_BOUNDS } from '../sigil/telemetry';
import { classify, type Rarity } from '../sigil/rarity';

/** Prices, index-aligned with TIER_BOUNDS. Cents, never floats. */
const AMOUNT_CENTS = [0, 299, 999, 2499, 4999, 9999] as const;

/** The ceremony's own name for each tier. Distinct from a rarity name. */
const TIER_NAMES = [
  'Sample',
  'Measure',
  'Draught',
  'Vessel',
  'Crucible',
  'Full Pour',
] as const;

export type Tier = {
  index: number;
  name: string;
  /** Droplets spawned per second. The clamp derives its droplet ceiling from it. */
  flow: number;
  amountCents: number;
};

export const TIERS: Tier[] = TIER_BOUNDS.map((bounds, index) => ({
  index,
  name: TIER_NAMES[index] ?? `Tier ${index}`,
  flow: bounds.flow,
  amountCents: AMOUNT_CENTS[index] ?? 0,
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
  if (amountCents <= 0) return 'Free';
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
    { dropletsLanded: 9e9, peakVelocity: 9e9, tiltEnergy: 0, holdMs: SIM.maxPourMs },
    tierIndex,
    SIM.maxPourMs,
  );
  return classify(telemetry, tierIndex);
}
