import { describe, expect, it } from 'vitest';

import { createPour, stepPour, telemetryOf, type PourInput } from './sim';
import { clampTelemetry, SIM } from '../sigil/telemetry';
import { reachableRarity, tierAt, TIERS } from './tiers';
import { hashSeed } from '../sigil/sigil';
import { classify } from '../sigil/rarity';

const HOLD: PourInput = { pouring: true, tiltDeg: 0 };
const RELEASE: PourInput = { pouring: false, tiltDeg: 0 };
const W = 360;
const FLOOR = 404;

/** Run the sim for `ms` at a fixed 16ms step. */
function run(tierIndex: number, ms: number, input: PourInput, from = createPour(tierIndex)) {
  let s = from;
  for (let t = 0; t < ms; t += 16) s = stepPour(s, input, 16, W, FLOOR);
  return s;
}

/** Hold, then let everything land. */
function pourAndSettle(tierIndex: number, holdMs: number) {
  let s = run(tierIndex, holdMs, HOLD);
  for (let i = 0; i < 400 && !s.settled; i++) s = stepPour(s, RELEASE, 16, W, FLOOR);
  return s;
}

describe('the pour sim', () => {
  it('spawns at the tier flow rate, within the tolerance the clamp allows', () => {
    for (const tier of TIERS) {
      const s = pourAndSettle(tier.index, 3000);
      const holdS = s.holdMs / 1000;
      const ceiling = Math.ceil(tier.flow * holdS * SIM.dropletTolerance);
      expect(s.dropletsLanded, `tier ${tier.index}`).toBeGreaterThan(0);
      expect(s.dropletsLanded, `tier ${tier.index} exceeded its own clamp ceiling`).toBeLessThanOrEqual(ceiling);
    }
  });

  // The whole point of importing SIM rather than re-typing its numbers: an honest
  // pour must never trip the clamp. If it does, the user watches a legitimate
  // pour get flagged as an overclaim.
  it('produces telemetry that its own clamp does not flag', () => {
    for (const tier of TIERS) {
      for (const holdMs of [500, 2000, 6000]) {
        const s = pourAndSettle(tier.index, holdMs);
        const { violations } = clampTelemetry(telemetryOf(s), tier.index, holdMs + 2000);
        expect(violations, `tier ${tier.index} at ${holdMs}ms`).toEqual([]);
      }
    }
  });

  it('stops at the ceremony hard stop', () => {
    const s = run(0, SIM.maxPourMs + 3000, HOLD);
    expect(s.holdMs).toBeLessThanOrEqual(SIM.maxPourMs);
    expect(s.finished).toBe(true);
  });

  it('does not accumulate hold time when the stream is closed', () => {
    const held = run(2, 1000, HOLD);
    const after = run(2, 2000, RELEASE, held);
    expect(after.holdMs).toBe(held.holdMs);
  });

  // Settling is what makes the preview honest. Droplets already in the air go on
  // landing after release, and each one moves the seed hash.
  describe('settling', () => {
    it('is false while droplets are still in the air', () => {
      const held = run(5, 1200, HOLD);
      expect(held.settled).toBe(false);
      const justReleased = stepPour(held, RELEASE, 16, W, FLOOR);
      expect(justReleased.settled, 'droplets were still falling').toBe(false);
    });

    it('becomes true once everything has landed', () => {
      const s = pourAndSettle(5, 1200);
      expect(s.settled).toBe(true);
      expect(s.droplets.every((d) => d.landed)).toBe(true);
    });

    it('freezes the telemetry, and so the seed, once settled', () => {
      const settled = pourAndSettle(4, 1500);
      const seedAt = (state: typeof settled) =>
        hashSeed({
          tierIndex: 4,
          amountCents: tierAt(4).amountCents,
          timestampMs: 1_785_000_000_000,
          telemetry: clampTelemetry(telemetryOf(state), 4, 30_000).telemetry,
        });

      const before = seedAt(settled);
      let s = settled;
      for (let i = 0; i < 120; i++) s = stepPour(s, RELEASE, 16, W, FLOOR);
      expect(telemetryOf(s)).toEqual(telemetryOf(settled));
      expect(seedAt(s), 'the sigil changed after the pour had settled').toBe(before);
    });

    it('is false before a pour has started', () => {
      expect(createPour(3).settled).toBe(false);
      expect(run(3, 500, RELEASE).settled).toBe(false);
    });
  });

  it('keeps landed splatter inside the vessel', () => {
    const s = pourAndSettle(5, 4000);
    for (const d of s.droplets) {
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThanOrEqual(W);
      expect(d.y).toBeLessThanOrEqual(FLOOR);
    }
  });

  it('records tilt only while pouring, and never above the device limit', () => {
    const tilted = run(3, 2000, { pouring: true, tiltDeg: 90 });
    const holdS = tilted.holdMs / 1000;
    expect(tilted.tiltEnergy).toBeGreaterThan(0);
    expect(tilted.tiltEnergy).toBeLessThanOrEqual(SIM.maxTiltRate * holdS + 1e-9);

    const still = run(3, 2000, HOLD);
    expect(still.tiltEnergy).toBe(0);
  });

  // The vessel now sizes itself to the viewport, so the same pour runs in a
  // different box on a phone and a monitor. What a pour EARNS must not depend on
  // that: droplets are spawned on a clock and settling waits for all of them, and
  // the clamp's velocity ceiling is time-based rather than distance-based.
  it('earns the same rarity regardless of how big the vessel is', () => {
    const sizes: [number, number][] = [
      [260, 288],
      [360, 404],
      [420, 474],
    ];

    const results = sizes.map(([w, h]) => {
      let s = createPour(4);
      for (let t = 0; t < 3000; t += 16) s = stepPour(s, HOLD, 16, w, h - 16);
      for (let i = 0; i < 400 && !s.settled; i++) s = stepPour(s, RELEASE, 16, w, h - 16);
      const { telemetry } = clampTelemetry(telemetryOf(s), 4, 30_000);
      return {
        size: `${w}x${h}`,
        droplets: telemetry.dropletsLanded,
        holdMs: telemetry.holdMs,
        rarity: classify(telemetry, 4),
      };
    });

    const first = results[0];
    for (const r of results.slice(1)) {
      expect(r.droplets, `${r.size} vs ${first.size}`).toBe(first.droplets);
      expect(r.holdMs, `${r.size} vs ${first.size}`).toBe(first.holdMs);
      expect(r.rarity, `${r.size} vs ${first.size}`).toBe(first.rarity);
    }
  });

  it('keeps splatter inside a vessel of any size', () => {
    for (const [w, h] of [[260, 288], [420, 474]] as [number, number][]) {
      let s = createPour(5);
      for (let t = 0; t < 2000; t += 16) s = stepPour(s, HOLD, 16, w, h - 16);
      for (let i = 0; i < 400 && !s.settled; i++) s = stepPour(s, RELEASE, 16, w, h - 16);
      for (const d of s.droplets) {
        expect(d.x, `${w}x${h}`).toBeGreaterThanOrEqual(0);
        expect(d.x, `${w}x${h}`).toBeLessThanOrEqual(w);
        expect(d.y, `${w}x${h}`).toBeLessThanOrEqual(h - 16);
      }
    }
  });

  // The ceremony prints this ceiling on every tier button. If the thresholds are
  // re-tuned and this is not, the UI starts promising a classification the tier
  // cannot mint — the exact dishonesty showing it was meant to remove.
  describe('the reachable ceiling shown on each tier', () => {
    it('is what a flawless pour actually earns', () => {
      const perfect = { dropletsLanded: 9e9, peakVelocity: 9e9, tiltEnergy: 0, holdMs: SIM.maxPourMs };
      for (const tier of TIERS) {
        const { telemetry } = clampTelemetry(perfect, tier.index, SIM.maxPourMs);
        expect(reachableRarity(tier.index), `tier ${tier.index}`).toBe(classify(telemetry, tier.index));
      }
    });

    it('never undersells a tier — no ordinary pour beats the stated ceiling', () => {
      const order = ['Common', 'Uncommon', 'Rare', 'Singular'];
      for (const tier of TIERS) {
        const ceiling = order.indexOf(reachableRarity(tier.index));
        for (const holdMs of [800, 2500, 7000, SIM.maxPourMs]) {
          const s = pourAndSettle(tier.index, holdMs);
          const { telemetry } = clampTelemetry(telemetryOf(s), tier.index, holdMs + 2000);
          expect(order.indexOf(classify(telemetry, tier.index)), `tier ${tier.index} at ${holdMs}ms`)
            .toBeLessThanOrEqual(ceiling);
        }
      }
    });

    it('rises with the tier and never falls', () => {
      const order = ['Common', 'Uncommon', 'Rare', 'Singular'];
      for (let t = 1; t < TIERS.length; t++) {
        expect(order.indexOf(reachableRarity(t)), `tier ${t} vs ${t - 1}`)
          .toBeGreaterThanOrEqual(order.indexOf(reachableRarity(t - 1)));
      }
    });
  });

  it('is frame-rate independent to within the spawn tolerance', () => {
    const stepAt = (dt: number) => {
      let s = createPour(4);
      for (let t = 0; t < 3000; t += dt) s = stepPour(s, HOLD, dt, W, FLOOR);
      return s.droplets.length;
    };
    // 60fps vs 30fps should spawn the same count: spawnDebt carries the remainder.
    expect(Math.abs(stepAt(16) - stepAt(33))).toBeLessThanOrEqual(2);
  });
});
