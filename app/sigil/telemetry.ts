/**
 * telemetry.ts — bounds on what a client is allowed to claim about a pour
 *
 * Shared by the app and the Go API (port, don't fork — see app/sigil/CLAUDE.md).
 * The server clamps again on receipt and stores the clamped values. The client
 * clamps only so the sigil preview matches what the server will mint.
 *
 * IMPORTANT: this bounds the damage, it does not stop cheating. A patched client
 * can still claim max-legal telemetry on every pour and mint Singular reliably.
 * Clamping caps the ceiling; closing the gap needs server-side replay of the
 * droplet sim from a recorded input trace. That is deliberately out of scope
 * until the ledger shows it matters — see the accepted-risk note at the bottom.
 */

export type Telemetry = {
  dropletsLanded: number;
  peakVelocity: number;
  tiltEnergy: number;
  holdMs: number;
};

/** The physics constants the clamp derives from. Keep in sync with the sim. */
export const SIM = {
  gravity: 1400,        // px/s^2
  spawnVyMax: 120,      // px/s
  spawnVxMax: 45,       // px/s
  maxPourMs: 15_000,    // ceremony hard stop
  maxTiltRate: 6,       // tilt-energy units per second, device-limited
  dropletTolerance: 1.15, // spawn jitter + frame-timing slack
} as const;

/** Per-tier facts the clamp needs. Mirrors TIERS in app/ceremony. */
export type TierBounds = { flow: number };

export const TIER_BOUNDS: TierBounds[] = [
  { flow: 10 }, { flow: 16 }, { flow: 20 }, { flow: 24 }, { flow: 28 }, { flow: 34 },
];

export type ClampResult = {
  telemetry: Telemetry;
  /** Fields the client overclaimed. Non-empty is a cheat signal worth logging. */
  violations: (keyof Telemetry)[];
};

/**
 * @param raw          what the client reported
 * @param tierIndex    purchased tier, already receipt-validated
 * @param wallClockMs  server-measured duration between pour-start and pour-end
 */
export function clampTelemetry(
  raw: Telemetry,
  tierIndex: number,
  wallClockMs: number,
): ClampResult {
  const tier = TIER_BOUNDS[tierIndex] ?? TIER_BOUNDS[0];
  const violations: (keyof Telemetry)[] = [];

  const take = <K extends keyof Telemetry>(key: K, value: number, max: number): number => {
    const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (safe > max) violations.push(key);
    return Math.min(safe, max);
  };

  // A pour cannot outlast the wall clock or the ceremony hard stop.
  const holdMs = take('holdMs', raw.holdMs, Math.min(wallClockMs, SIM.maxPourMs));
  const holdS = holdMs / 1000;

  // Droplets are spawned at a fixed rate. Nothing else can create them.
  const maxDroplets = Math.ceil(tier.flow * holdS * SIM.dropletTolerance);
  const dropletsLanded = take('dropletsLanded', raw.dropletsLanded, maxDroplets);

  // Terminal velocity of the longest possible fall, plus bounce headroom.
  //
  // IMPORTANT: explicit sqrt, not Math.hypot. Go's math.Hypot and JS's
  // Math.hypot are both allowed to differ in the last ulp, and this value
  // feeds hashSeed — a one-bit difference mints a different sigil than the
  // client previewed. Keep the operation order identical in the Go port.
  const maxFall = SIM.spawnVyMax + SIM.gravity * Math.min(holdS, 1.2);
  const maxSpeed = Math.sqrt(maxFall * maxFall + SIM.spawnVxMax * SIM.spawnVxMax) * 1.1;
  const peakVelocity = take('peakVelocity', raw.peakVelocity, maxSpeed);

  // Tilt is integrated over time and rate-limited by the accelerometer.
  const tiltEnergy = take('tiltEnergy', raw.tiltEnergy, SIM.maxTiltRate * holdS);

  return {
    telemetry: { dropletsLanded, peakVelocity, tiltEnergy, holdMs },
    violations,
  };
}

/**
 * Accepted risk, revisit when the ledger justifies it:
 *
 * A max-legal claim on every pour yields roughly the top of the achievable
 * rarity band for that tier. At current thresholds that is Rare-to-Singular on
 * tiers 3-5. We accept this because the cheat costs the user real money per
 * attempt (sigils only mint on a validated receipt), so the exploit's payoff is
 * a cosmetic collectible they already paid full price for.
 *
 * Escalate to input-trace replay if either holds:
 *   - violations fire on >2% of pours
 *   - Singular share on tiers 3-5 exceeds 2x the modeled rate
 */
