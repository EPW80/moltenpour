/**
 * rarity.ts — what the pour earned, as opposed to what the pour cost
 *
 * Shared by the app and the Go API (port, don't fork — see app/sigil/CLAUDE.md).
 * The client computes rarity to label the preview; the server recomputes it to
 * mint. Same drift risk as the hash, same referee: testdata/corpus.json.
 *
 * TWO AXES, DELIBERATELY SEPARATE:
 *
 *   tierIndex (0-5)  what was PURCHASED. Sets flow, price, and the certificate's
 *                    CONSIDERATION row.
 *   Rarity           what was EARNED. Sets the accent pair, SUBSTANCE and
 *                    CLASSIFICATION.
 *
 * The certificate handoff's tier table collapses these into one four-valued
 * field with a price attached to each name. That reading cannot represent the six
 * price points in TIER_BOUNDS, and it contradicts the product brief's hard
 * constraint that "rarity is earned from how the user poured". So they are split
 * here: you buy a tier, you earn a rarity, and a Common outcome on the most
 * expensive tier is a real and intended result.
 *
 * IMPORTANT: nothing in this file is random. Rarity is a pure function of the
 * clamped telemetry and the purchased tier. There is no hash jitter and no luck
 * component, because the brief forbids any suggestion of a randomized outcome.
 */

import { SIM, TIER_BOUNDS, type Telemetry } from './telemetry';

export const RARITIES = ['Common', 'Uncommon', 'Rare', 'Singular'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Thresholds on the 0-1000 pour score. Provisional.
 *
 * Tuned so Common lands near the 55% the certificate handoff expects. They are
 * calibrated against the corpus, which is uniform noise rather than real pours —
 * so they must be re-tuned once the ledger has real data. The escalation triggers
 * at the bottom of telemetry.ts are what tells you when: if the Singular share on
 * tiers 3-5 runs above twice the modeled rate, this is the table to look at.
 */
const THRESHOLDS = {
  uncommon: 533,
  rare: 665,
  singular: 771,
} as const;

/**
 * How much of the achievable score each tier can reach: 0.55 at tier 0 rising to
 * 1.00 at tier 5.
 *
 * This is what keeps the accepted-risk note in telemetry.ts true — a client that
 * claims max-legal telemetry on every pour reaches Rare-to-Singular on tiers 3-5,
 * and cannot reach Singular at all on the cheap tiers.
 */
const TIER_REACH_BASE = 55;
const TIER_REACH_STEP = 9;

/**
 * IMPORTANT: this function is integer arithmetic on purpose.
 *
 * A score compared against a float threshold can flip rarity on a last-ulp
 * difference between the two languages, which mints a different classification
 * than the user previewed. So every metric is reduced to permille with an
 * explicit floor before anything is compared. IEEE-754 division and floor are
 * exact and identical in both languages; the ordering of these operations still
 * has to match the Go port line for line.
 *
 * The inputs are the same rounded integers hashSeed consumes, so a value that
 * cannot change the hash cannot change the rarity either.
 */
function pourScore(telemetry: Telemetry, tierIndex: number): number {
  // IMPORTANT: clamp once and use the clamped index for both the flow lookup and
  // the reach multiplier. Falling back to TIER_BOUNDS[0] for the flow while
  // scaling reach by the top tier scores an out-of-range tier *higher* than a
  // legitimate one, and disagrees with the Go port, which clamps consistently.
  const tier = TIER_BOUNDS[clampTierIndex(tierIndex)];
  const holdMs = Math.floor(telemetry.holdMs);
  const holdS = holdMs / 1000;

  // Ceilings, recomputed exactly as clampTelemetry derived them.
  const maxDroplets = Math.ceil(tier.flow * holdS * SIM.dropletTolerance);
  const maxFall = SIM.spawnVyMax + SIM.gravity * Math.min(holdS, 1.2);
  const maxSpeed = Math.round(Math.sqrt(maxFall * maxFall + SIM.spawnVxMax * SIM.spawnVxMax) * 1.1);
  const maxTiltMilli = Math.round(SIM.maxTiltRate * holdS * 1000);

  const permille = (value: number, max: number): number => {
    if (max <= 0) return 0;
    const p = Math.floor((value * 1000) / max);
    return p < 0 ? 0 : p > 1000 ? 1000 : p;
  };

  // How full the pour was against what the tier allowed.
  const fill = permille(Math.floor(telemetry.dropletsLanded), maxDroplets);
  // How hard it came down.
  const force = permille(Math.round(telemetry.peakVelocity), maxSpeed);
  // How long they committed, against the ceremony hard stop.
  const commitment = permille(holdMs, SIM.maxPourMs);
  // A steady hand is the skill the ceremony actually rewards, so tilt counts
  // against you. It is also why a max-everything cheat does not score perfectly.
  const steadiness = 1000 - permille(Math.round(telemetry.tiltEnergy * 1000), maxTiltMilli);

  const base = Math.floor((fill * 40 + force * 25 + commitment * 20 + steadiness * 15) / 100);

  const reach = TIER_REACH_BASE + TIER_REACH_STEP * clampTierIndex(tierIndex);
  return Math.floor((base * reach) / 100);
}

function clampTierIndex(tierIndex: number): number {
  if (!Number.isFinite(tierIndex)) return 0;
  const i = Math.floor(tierIndex);
  return i < 0 ? 0 : i >= TIER_BOUNDS.length ? TIER_BOUNDS.length - 1 : i;
}

/** The score behind a rarity, exposed for tuning and for the drift corpus. */
export function rarityScore(telemetry: Telemetry, tierIndex: number): number {
  return pourScore(telemetry, tierIndex);
}

export function classify(telemetry: Telemetry, tierIndex: number): Rarity {
  const score = pourScore(telemetry, tierIndex);
  if (score >= THRESHOLDS.singular) return 'Singular';
  if (score >= THRESHOLDS.rare) return 'Rare';
  if (score >= THRESHOLDS.uncommon) return 'Uncommon';
  return 'Common';
}
