/**
 * rig.ts — the metaball simulation behind a pour, and the telemetry tap inside it
 *
 * The instrument and the record are the same thing. The blobs the shader draws
 * are the blobs counted here: a droplet is counted on first floor contact, peak
 * velocity is sampled from live blob velocity, and those exact numbers are what
 * gets hashed into the sigil seed. What the user watches is what gets certified.
 *
 * Pure TypeScript: no WebGL, no DOM, no framework. app/ceremony/metaball.ts only
 * paints what this produces, which is why WebGL being unavailable costs the user
 * the picture and not the pour — and why the four invariants below can be tested
 * without a GL context.
 *
 * IMPORTANT: every physics constant comes from SIM in app/sigil/telemetry.ts and
 * every flow rate from the tier. The clamp derives its ceilings from those same
 * values, so a number re-typed here rather than imported would let the rig
 * produce telemetry its own clamp rejects — the user would watch a legitimate
 * pour come back flagged as an overclaim.
 *
 * THE FOUR INVARIANTS. Violating any of them produces a pour that is silently
 * clamped and reported as tampered:
 *
 *   1. Spawn at exactly the tier's flow rate — `spawnAcc += dt * flow`, no
 *      multiplier. The clamp permits ceil(flow * seconds * 1.15) landings, so
 *      spawning at exactly flow guarantees landings can never exceed it. The
 *      design prototype spawned at flow * 1.1 because it looked better; that
 *      number must not survive into anything that reports telemetry.
 *   2. Record velocity in sim units, not device pixels. The loop integrates in
 *      device pixels (gravity * scale) but the clamp's ceiling is scale-free, so
 *      the sample is divided by scale at the moment it is taken. Without this a
 *      retina display inflates every pour past the clamp.
 *   3. Sample peak velocity only from blobs that have not yet landed, and only
 *      while the stream is open. Post-bounce velocities describe the aftermath,
 *      not the pour, and the clamp ceilings against a droplet that fell for the
 *      hold.
 *   4. Count a landing exactly once, via the per-slot landed flag, and clear
 *      that flag when the slot is reused.
 */

import { SIM, type Telemetry } from "../sigil/telemetry";
import type { Tier, TierFeel } from "./tiers";

/**
 * Slots in the ring buffer.
 *
 * IMPORTANT: compiled into the fragment shader's uniform array sizes from this
 * same constant. The two must match exactly or the rig writes past what the
 * shader reads.
 */
export const MAX_BLOBS = 32;

/**
 * Where the stream leaves the spout and where the floor is, as fractions of the
 * stage height.
 *
 * The stage draws a callout on each line. Both read these, so the labels cannot
 * drift away from the physics they are naming.
 */
export const SPOUT_Y = 0.2;
export const FLOOR_Y = 0.82;

/**
 * Sim units are device pixels at a 900px-tall stage. Everything spatial is
 * multiplied by this and peak velocity is divided back out by it — see
 * invariant 2.
 */
const SIM_HEIGHT = 900;

/** How fast the eased feel chases the selected tier. Per second. */
const FEEL_EASE_RATE = 4.5;

/** A long frame must not teleport blobs. Matches the old droplet sim's cap. */
const MAX_FRAME_MS = 50;

export type RigInput = {
  /** Is the user holding the vessel this frame? */
  pouring: boolean;
  /** Lean of the stream, -1 (left) to 1 (right). */
  lean: number;
  /** The selected tier. Its feel is a target, not a jump. */
  tier: Tier;
};

export type Rig = {
  /** x,y per slot, in device pixels. */
  pos: Float32Array;
  /** vx,vy per slot, in device pixels per second. */
  vel: Float32Array;
  /** Radius per slot. Zero marks a free slot, to the rig and to the shader. */
  rad: Float32Array;
  /** Has this slot touched the floor? Cleared on reuse — invariant 4. */
  landed: Uint8Array;
  cursor: number;
  /** Fractional droplets carried between frames, so flow is frame-rate independent. */
  spawnAcc: number;

  /** The eased feel. The shader reads this, not the tier's target. */
  feel: TierFeel;

  holdMs: number;
  dropletsLanded: number;
  peakVelocity: number;
  tiltEnergy: number;

  /** Slots in use, for the stage readout. Not telemetry. */
  alive: number;
  /** Blobs that have not yet landed. Zero is what "settled" means. */
  airborne: number;
  /** The ceremony hard stop has been reached; the vessel accepts no more. */
  finished: boolean;

  random: () => number;
};

/** Deterministic per-rig jitter, so a replay of the same inputs looks the same. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRig(tier: Tier, seed = 0x9e3779b9): Rig {
  return {
    pos: new Float32Array(MAX_BLOBS * 2),
    vel: new Float32Array(MAX_BLOBS * 2),
    rad: new Float32Array(MAX_BLOBS),
    landed: new Uint8Array(MAX_BLOBS),
    cursor: 0,
    spawnAcc: 0,
    feel: { ...tier.feel },
    holdMs: 0,
    dropletsLanded: 0,
    peakVelocity: 0,
    tiltEnergy: 0,
    alive: 0,
    airborne: 0,
    finished: false,
    random: makeRandom(seed),
  };
}

/**
 * Empty the vessel and the accumulator.
 *
 * The eased feel is deliberately left where it is: discarding should not make
 * the fluid snap to a new thickness, and the next frame eases it anyway.
 */
export function resetRig(rig: Rig): void {
  rig.pos.fill(0);
  rig.vel.fill(0);
  rig.rad.fill(0);
  rig.landed.fill(0);
  rig.cursor = 0;
  rig.spawnAcc = 0;
  rig.holdMs = 0;
  rig.dropletsLanded = 0;
  rig.peakVelocity = 0;
  rig.tiltEnergy = 0;
  rig.alive = 0;
  rig.airborne = 0;
  rig.finished = false;
}

/**
 * Advance the rig by `dtMs` against a stage of `width` x `height` device pixels.
 *
 * Mutates in place. The blob arrays are handed straight to the shader as uniform
 * data every frame, and allocating a new set sixty times a second to keep this
 * pure would cost more than it buys.
 */
export function stepRig(
  rig: Rig,
  input: RigInput,
  dtMs: number,
  width: number,
  height: number,
): void {
  // Physics integrate on a capped frame; hold time tracks the real clock. Both
  // cap in the safe direction: a long frame spawns fewer droplets than the hold
  // it reports allows, so the clamp's ceiling is never approached from below.
  const dt = Math.min(dtMs, MAX_FRAME_MS) / 1000;

  const target = input.tier.feel;
  const k = Math.min(1, dt * FEEL_EASE_RATE);
  const feel = rig.feel;
  feel.viscosity += (target.viscosity - feel.viscosity) * k;
  feel.iridescence += (target.iridescence - feel.iridescence) * k;
  feel.roughness += (target.roughness - feel.roughness) * k;
  feel.radius += (target.radius - feel.radius) * k;

  const scale = height / SIM_HEIGHT;
  const spoutX = width * 0.5;
  const spoutY = height * SPOUT_Y;
  const floorY = height * FLOOR_Y;

  // Once the hard stop is reached the vessel takes nothing more, whatever the
  // caller says. The screen closes the stream on the same condition; this is the
  // guarantee that the telemetry cannot outrun the clamp if it does not.
  const pouring = input.pouring && !rig.finished;

  if (pouring) {
    rig.holdMs = Math.min(rig.holdMs + dtMs, SIM.maxPourMs);
    rig.tiltEnergy += Math.min(Math.abs(input.lean), 1) * SIM.maxTiltRate * dt;

    // Invariant 1: exactly the tier's flow, no multiplier.
    rig.spawnAcc += dt * input.tier.flow;
    while (rig.spawnAcc >= 1) {
      rig.spawnAcc -= 1;
      const i = rig.cursor;
      rig.cursor = (rig.cursor + 1) % MAX_BLOBS;
      const r = rig.random;
      rig.pos[i * 2] =
        spoutX + (r() - 0.5) * 28 * scale + input.lean * width * 0.16;
      rig.pos[i * 2 + 1] = spoutY;
      rig.vel[i * 2] =
        ((r() - 0.5) * 2 * SIM.spawnVxMax + input.lean * SIM.spawnVxMax) *
        scale;
      rig.vel[i * 2 + 1] = r() * SIM.spawnVyMax * scale;
      rig.rad[i] = feel.radius * scale * (0.7 + r() * 0.6);
      // Invariant 4: the slot's history is cleared with the slot.
      rig.landed[i] = 0;
    }
  } else {
    rig.spawnAcc = 0;
  }

  const drag = Math.pow(1 - feel.viscosity * 0.55, dt * 8);
  let alive = 0;
  let airborne = 0;

  for (let i = 0; i < MAX_BLOBS; i++) {
    if (rig.rad[i] <= 0) continue;
    alive += 1;

    rig.vel[i * 2 + 1] += SIM.gravity * scale * dt;
    rig.vel[i * 2] *= drag;
    rig.pos[i * 2] += rig.vel[i * 2] * dt;
    rig.pos[i * 2 + 1] += rig.vel[i * 2 + 1] * dt;

    if (!rig.landed[i]) {
      airborne += 1;
      // Invariants 2 and 3: sim units, unlanded blobs, open stream only.
      //
      // Explicit sqrt rather than Math.hypot, matching the clamp. Keeping one
      // spelling of this expression across the codebase is the cheap way to
      // never have to work out which one mattered.
      const vx = rig.vel[i * 2];
      const vy = rig.vel[i * 2 + 1];
      const speed = Math.sqrt(vx * vx + vy * vy) / scale;
      if (pouring && speed > rig.peakVelocity) rig.peakVelocity = speed;
    }

    if (rig.pos[i * 2 + 1] > floorY) {
      rig.pos[i * 2 + 1] = floorY;
      rig.vel[i * 2 + 1] *= -(0.28 * (1 - feel.viscosity));
      rig.vel[i * 2] *= 1 - feel.viscosity * 0.7;
      rig.rad[i] *= 1 - 0.12 * feel.viscosity;
      if (!rig.landed[i]) {
        rig.landed[i] = 1;
        rig.dropletsLanded += 1;
      }
    }

    // Free the slot once the blob has left the stage or dissolved into the pool.
    if (
      rig.pos[i * 2] < -80 ||
      rig.pos[i * 2] > width + 80 ||
      rig.rad[i] < 4 * scale
    ) {
      rig.rad[i] = 0;
    }
  }

  rig.alive = alive;
  rig.airborne = airborne;
  rig.finished = rig.holdMs >= SIM.maxPourMs;
}

/**
 * The pour is over and the telemetry can no longer change.
 *
 * IMPORTANT: nothing may be minted before this is true. Blobs still in the air
 * when the user lets go go on landing for another second or so, and each one
 * moves dropletsLanded — which moves the seed hash, which changes the sigil.
 * Minting mid-settle means the artifact the user watched form is not the
 * artifact they receive, which is the exact failure this pipeline exists to
 * prevent.
 */
export function isSettled(rig: Rig, pouring: boolean): boolean {
  return !pouring && rig.holdMs > 0 && rig.airborne === 0;
}

/** What the client reports. The server clamps it again and stores its own result. */
export function telemetryOf(rig: Rig): Telemetry {
  return {
    dropletsLanded: rig.dropletsLanded,
    peakVelocity: rig.peakVelocity,
    tiltEnergy: rig.tiltEnergy,
    holdMs: Math.floor(rig.holdMs),
  };
}
