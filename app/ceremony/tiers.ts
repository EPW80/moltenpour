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

import { SIM, TIER_BOUNDS } from '../sigil/telemetry';

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
 * `USD 99.99`, or `Free` at zero.
 *
 * IMPORTANT: plain text, never a currency glyph. The product brief forbids
 * dollar-sign iconography and anything resembling real currency — US currency
 * imagery carries legal restrictions, so the product uses abstract metal only.
 */
export function formatConsideration(amountCents: number): string {
  if (amountCents <= 0) return 'Free';
  return `USD ${(amountCents / 100).toFixed(2)}`;
}

/** The ceremony hard stop, re-exported so screens don't reach into SIM. */
export const MAX_POUR_MS = SIM.maxPourMs;
