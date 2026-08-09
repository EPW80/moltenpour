import { describe, expect, it } from "vitest";

import {
  createRig,
  isSettled,
  MAX_BLOBS,
  stepRig,
  telemetryOf,
  type Rig,
  type RigInput,
} from "./rig";
import { clampTelemetry, SIM } from "../sigil/telemetry";
import { reachableRarity, tierAt, TIERS } from "./tiers";
import { hashSeed } from "../sigil/sigil";
import { classify } from "../sigil/rarity";

/** A 9:16 stage at the rig's own reference height, in device pixels. */
const H = 900;
const W = Math.round((H * 9) / 16);

const hold = (tierIndex: number): RigInput => ({
  pouring: true,
  lean: 0,
  tier: tierAt(tierIndex),
});
const release = (tierIndex: number): RigInput => ({
  pouring: false,
  lean: 0,
  tier: tierAt(tierIndex),
});

/** Run for `ms` at a fixed step. */
function run(rig: Rig, input: RigInput, ms: number, dt = 16, w = W, h = H) {
  for (let t = 0; t < ms; t += dt) stepRig(rig, input, dt, w, h);
  return rig;
}

/** Hold, then let everything land. */
function pourAndSettle(tierIndex: number, holdMs: number, w = W, h = H) {
  const rig = createRig(tierAt(tierIndex));
  run(rig, hold(tierIndex), holdMs, 16, w, h);
  for (let i = 0; i < 400 && !isSettled(rig, false); i++) {
    stepRig(rig, release(tierIndex), 16, w, h);
  }
  return rig;
}

describe("the metaball rig", () => {
  it("spawns at the tier flow rate, within the tolerance the clamp allows", () => {
    for (const tier of TIERS) {
      const rig = pourAndSettle(tier.index, 3000);
      const holdS = rig.holdMs / 1000;
      const ceiling = Math.ceil(tier.flow * holdS * SIM.dropletTolerance);
      expect(rig.dropletsLanded, `tier ${tier.index}`).toBeGreaterThan(0);
      expect(
        rig.dropletsLanded,
        `tier ${tier.index} exceeded its own clamp ceiling`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  // The whole point of importing SIM rather than re-typing its numbers: an honest
  // pour must never trip the clamp. If it does, the user watches a legitimate
  // pour get flagged as an overclaim and the record comes back marked tampered.
  it("produces telemetry that its own clamp does not flag", () => {
    for (const tier of TIERS) {
      for (const holdMs of [500, 2000, 6000]) {
        const rig = pourAndSettle(tier.index, holdMs);
        const { violations } = clampTelemetry(
          telemetryOf(rig),
          tier.index,
          holdMs + 2000,
        );
        expect(violations, `tier ${tier.index} at ${holdMs}ms`).toEqual([]);
      }
    }
  });

  it("stops at the ceremony hard stop", () => {
    const rig = createRig(tierAt(0));
    run(rig, hold(0), SIM.maxPourMs + 3000);
    expect(rig.holdMs).toBeLessThanOrEqual(SIM.maxPourMs);
    expect(rig.finished).toBe(true);
  });

  it("accepts nothing more once the hard stop is reached, whatever the caller says", () => {
    const rig = createRig(tierAt(5));
    run(rig, hold(5), SIM.maxPourMs + 500);
    const at = telemetryOf(rig);
    run(rig, hold(5), 3000);
    expect(telemetryOf(rig).holdMs).toBe(at.holdMs);
    expect(rig.tiltEnergy).toBeLessThanOrEqual(
      SIM.maxTiltRate * (SIM.maxPourMs / 1000) + 1e-9,
    );
  });

  it("does not accumulate hold time when the stream is closed", () => {
    const rig = createRig(tierAt(2));
    run(rig, hold(2), 1000);
    const held = rig.holdMs;
    run(rig, release(2), 2000);
    expect(rig.holdMs).toBe(held);
  });

  // Settling is what makes the record honest. Blobs already in the air go on
  // landing after release, and each one moves the seed hash.
  describe("settling", () => {
    it("is false while blobs are still in the air", () => {
      const rig = createRig(tierAt(5));
      run(rig, hold(5), 1200);
      expect(isSettled(rig, true)).toBe(false);
      stepRig(rig, release(5), 16, W, H);
      expect(isSettled(rig, false), "blobs were still falling").toBe(false);
    });

    it("becomes true once everything has landed", () => {
      const rig = pourAndSettle(5, 1200);
      expect(isSettled(rig, false)).toBe(true);
      expect(rig.airborne).toBe(0);
    });

    it("freezes the telemetry, and so the seed, once settled", () => {
      const rig = pourAndSettle(4, 1500);
      const seedNow = () =>
        hashSeed({
          tierIndex: 4,
          amountCents: tierAt(4).amountCents,
          timestampMs: 1_785_000_000_000,
          telemetry: clampTelemetry(telemetryOf(rig), 4, 30_000).telemetry,
        });

      const before = seedNow();
      const telemetryBefore = telemetryOf(rig);
      run(rig, release(4), 2000);
      expect(telemetryOf(rig)).toEqual(telemetryBefore);
      expect(seedNow(), "the sigil changed after the pour had settled").toBe(
        before,
      );
    });

    it("is false before a pour has started", () => {
      expect(isSettled(createRig(tierAt(3)), false)).toBe(false);
      const rig = createRig(tierAt(3));
      run(rig, release(3), 500);
      expect(isSettled(rig, false)).toBe(false);
    });
  });

  it("records tilt only while pouring, and never above the device limit", () => {
    const tilted = createRig(tierAt(3));
    run(tilted, { pouring: true, lean: 1, tier: tierAt(3) }, 2000);
    expect(tilted.tiltEnergy).toBeGreaterThan(0);
    expect(tilted.tiltEnergy).toBeLessThanOrEqual(
      SIM.maxTiltRate * (tilted.holdMs / 1000) + 1e-9,
    );

    const still = createRig(tierAt(3));
    run(still, hold(3), 2000);
    expect(still.tiltEnergy).toBe(0);
  });

  // Invariant 2, and the reason peak velocity is divided by scale at the sample.
  // The loop integrates in device pixels; the clamp's ceiling is scale-free. A
  // retina stage that reported raw pixel velocity would flag every pour on it.
  it("earns the same rarity regardless of how big the stage is", () => {
    const sizes: [number, number][] = [
      [W, H],
      [Math.round(W / 2), Math.round(H / 2)],
      [W * 2, H * 2],
    ];

    const results = sizes.map(([w, h]) => {
      const rig = pourAndSettle(4, 3000, w, h);
      const { telemetry, violations } = clampTelemetry(
        telemetryOf(rig),
        4,
        30_000,
      );
      return {
        size: `${w}x${h}`,
        droplets: telemetry.dropletsLanded,
        holdMs: telemetry.holdMs,
        peak: Math.round(telemetry.peakVelocity),
        rarity: classify(telemetry, 4),
        violations,
      };
    });

    const first = results[0];
    for (const r of results) {
      expect(r.violations, `${r.size} was clamped`).toEqual([]);
      expect(r.droplets, `${r.size} vs ${first.size}`).toBe(first.droplets);
      expect(r.holdMs, `${r.size} vs ${first.size}`).toBe(first.holdMs);
      expect(r.peak, `${r.size} vs ${first.size}`).toBe(first.peak);
      expect(r.rarity, `${r.size} vs ${first.size}`).toBe(first.rarity);
    }
  });

  // Invariant 4. A blob rests on the floor and goes on being integrated for as
  // long as its slot lives; counting it per contact rather than per landing
  // would inflate every pour past its ceiling within a second.
  it("counts a landing once, however long the blob sits in the pool", () => {
    const rig = pourAndSettle(1, 1000);
    const landed = rig.dropletsLanded;
    run(rig, release(1), 4000);
    expect(rig.dropletsLanded).toBe(landed);
  });

  it("never fills more than the slots it has, and frees them again", () => {
    const rig = createRig(tierAt(5));
    for (let t = 0; t < 6000; t += 16) {
      stepRig(rig, hold(5), 16, W, H);
      expect(rig.alive).toBeLessThanOrEqual(MAX_BLOBS);
      expect(rig.airborne).toBeLessThanOrEqual(rig.alive);
    }
    run(rig, release(5), 6000);
    expect(rig.alive, "the pool never drained").toBeLessThan(MAX_BLOBS);
  });

  // The ceremony prints this ceiling on every tier row. If the thresholds are
  // re-tuned and this is not, the UI starts promising a classification the tier
  // cannot mint — the exact dishonesty showing it was meant to remove.
  describe("the reachable ceiling shown on each tier", () => {
    it("is what a flawless pour actually earns", () => {
      const perfect = {
        dropletsLanded: 9e9,
        peakVelocity: 9e9,
        tiltEnergy: 0,
        holdMs: SIM.maxPourMs,
      };
      for (const tier of TIERS) {
        const { telemetry } = clampTelemetry(
          perfect,
          tier.index,
          SIM.maxPourMs,
        );
        expect(reachableRarity(tier.index), `tier ${tier.index}`).toBe(
          classify(telemetry, tier.index),
        );
      }
    });

    it("never undersells a tier — no ordinary pour beats the stated ceiling", () => {
      const order = ["Common", "Uncommon", "Rare", "Singular"];
      for (const tier of TIERS) {
        const ceiling = order.indexOf(reachableRarity(tier.index));
        for (const holdMs of [800, 2500, 7000, SIM.maxPourMs]) {
          const rig = pourAndSettle(tier.index, holdMs);
          const { telemetry } = clampTelemetry(
            telemetryOf(rig),
            tier.index,
            holdMs + 2000,
          );
          expect(
            order.indexOf(classify(telemetry, tier.index)),
            `tier ${tier.index} at ${holdMs}ms`,
          ).toBeLessThanOrEqual(ceiling);
        }
      }
    });

    it("rises with the tier and never falls", () => {
      const order = ["Common", "Uncommon", "Rare", "Singular"];
      for (let t = 1; t < TIERS.length; t++) {
        expect(
          order.indexOf(reachableRarity(t)),
          `tier ${t} vs ${t - 1}`,
        ).toBeGreaterThanOrEqual(order.indexOf(reachableRarity(t - 1)));
      }
    });
  });

  it("is frame-rate independent to within the spawn tolerance", () => {
    const landedAt = (dt: number) => {
      const rig = createRig(tierAt(4));
      run(rig, hold(4), 3000, dt);
      for (let i = 0; i < 400 && !isSettled(rig, false); i++)
        stepRig(rig, release(4), dt, W, H);
      return rig.dropletsLanded;
    };
    // 60fps against 30fps must land the same count: spawnAcc carries the remainder.
    expect(Math.abs(landedAt(16) - landedAt(33))).toBeLessThanOrEqual(2);
  });

  it("eases the fluid toward the selected tier rather than cutting to it", () => {
    const rig = createRig(tierAt(0));
    const from = rig.feel.viscosity;
    stepRig(rig, hold(5), 16, W, H);
    const afterOneFrame = rig.feel.viscosity;
    expect(
      afterOneFrame,
      "the feel jumped straight to the new tier",
    ).toBeLessThan(tierAt(5).feel.viscosity);
    expect(afterOneFrame).toBeGreaterThan(from);

    run(rig, hold(5), 3000);
    expect(rig.feel.viscosity).toBeCloseTo(tierAt(5).feel.viscosity, 3);
  });
});
