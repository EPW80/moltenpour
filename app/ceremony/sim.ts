/**
 * sim.ts — the droplet simulation behind a pour
 *
 * Pure TypeScript with no framework imports and no DOM access, so the pour logic
 * can be driven by a React screen today and a native shell later without a
 * rewrite. The screen owns the animation frame and the input; this owns the
 * physics and the telemetry.
 *
 * IMPORTANT: every constant comes from SIM in app/sigil/telemetry.ts. The clamp
 * derives its ceilings from those same values, so a number re-typed here rather
 * than imported would let the sim produce telemetry its own clamp rejects — the
 * user would watch a legitimate pour get flagged as an overclaim.
 */

import { SIM, type Telemetry } from '../sigil/telemetry';
import { tierAt } from './tiers';

export type Droplet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Landed droplets stop integrating and stay put as splatter. */
  landed: boolean;
};

export type PourState = {
  tierIndex: number;
  droplets: Droplet[];
  /** Milliseconds the stream has actually been running. */
  holdMs: number;
  dropletsLanded: number;
  peakVelocity: number;
  tiltEnergy: number;
  /** Fractional droplets carried between frames so flow is frame-rate independent. */
  spawnDebt: number;
  finished: boolean;
  /**
   * The stream is closed and every droplet has landed, so the telemetry can no
   * longer change.
   *
   * IMPORTANT: nothing may be minted before this is true. Droplets already in the
   * air when the user lets go go on landing for another second or so, and each
   * one moves dropletsLanded and peakVelocity — which moves the seed hash, which
   * changes the sigil. Minting mid-settle means the artifact the user watched
   * form is not the artifact they receive, which is the exact failure this whole
   * pipeline exists to prevent.
   */
  settled: boolean;
};

export type PourInput = {
  /** Is the user holding the pour control this frame? */
  pouring: boolean;
  /** Device tilt in degrees, clamped by the caller to something sane. */
  tiltDeg: number;
};

export function createPour(tierIndex: number): PourState {
  return {
    tierIndex,
    droplets: [],
    holdMs: 0,
    dropletsLanded: 0,
    peakVelocity: 0,
    tiltEnergy: 0,
    spawnDebt: 0,
    finished: false,
    settled: false,
  };
}

/** Deterministic per-pour jitter, so a replay of the same inputs looks the same. */
function makeJitter(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const jitter = makeJitter(0x9e3779b9);

/**
 * Advance the pour by `dtMs`.
 *
 * `floorY` is where the splatter settles and `width` how wide the vessel is —
 * both in the screen's own units, since nothing downstream depends on them.
 */
export function stepPour(
  state: PourState,
  input: PourInput,
  dtMs: number,
  width: number,
  floorY: number,
): PourState {
  if (state.finished) return state;

  const dt = Math.min(dtMs, 50) / 1000; // a long frame must not teleport droplets
  const tier = tierAt(state.tierIndex);

  let { holdMs, dropletsLanded, peakVelocity, tiltEnergy, spawnDebt } = state;
  const droplets = state.droplets;

  if (input.pouring) {
    holdMs += dtMs;

    // Tilt is integrated over time and rate-limited by the accelerometer, which
    // is exactly how clampTelemetry bounds it.
    const tiltRate = Math.min(Math.abs(input.tiltDeg) / 45, 1) * SIM.maxTiltRate;
    tiltEnergy += tiltRate * dt;

    // Droplets are spawned at a fixed rate. Nothing else creates them — the
    // clamp's droplet ceiling assumes precisely this.
    spawnDebt += tier.flow * dt;
    while (spawnDebt >= 1) {
      spawnDebt -= 1;
      const lean = Math.max(-1, Math.min(1, input.tiltDeg / 45));
      droplets.push({
        x: width / 2 + lean * width * 0.18 + (jitter() - 0.5) * 14,
        y: 0,
        vx: (jitter() - 0.5) * 2 * SIM.spawnVxMax + lean * SIM.spawnVxMax,
        vy: jitter() * SIM.spawnVyMax,
        r: 2 + jitter() * 4,
        landed: false,
      });
    }
  }

  for (const d of droplets) {
    if (d.landed) continue;
    d.vy += SIM.gravity * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;

    // Explicit sqrt rather than Math.hypot, matching the clamp. Nothing here
    // feeds the hash directly, but peakVelocity does feed the clamp, and keeping
    // one spelling of this expression across the codebase is the cheap way to
    // never have to work out which one mattered.
    const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);

    // IMPORTANT: only while the stream is open.
    //
    // The clamp ceilings peak velocity at spawnVyMax + gravity * min(holdS, 1.2)
    // — a droplet that has been falling for the whole hold. Droplets already in
    // the air keep accelerating through the settle, so measuring them there
    // reports a speed the clamp then rejects, and a short honest pour gets
    // flagged as an overclaim. The telemetry describes the pour, not its
    // aftermath.
    if (input.pouring && speed > peakVelocity) peakVelocity = speed;

    if (d.y >= floorY) {
      d.y = floorY;
      d.landed = true;
      dropletsLanded += 1;

      // Splatter on impact.
      //
      // Purely visual: it moves where the blob sits on screen and touches
      // nothing the clamp or the hash reads. Without it the pile is about 70px
      // wide — spawnVxMax is 45 against a gravity of 1400, so a droplet drifts
      // barely 35px over its whole fall — and a vessel with a thin stripe at the
      // bottom does not read as splatter.
      const spread = (jitter() - 0.5) * speed * 0.12;
      d.x = Math.max(d.r, Math.min(width - d.r, d.x + spread));
      // A little depth too, or every droplet sits on one scanline and the pool
      // reads as a drawn rule rather than a puddle.
      d.y = floorY - jitter() * 7;
    }
  }

  const finished = holdMs >= SIM.maxPourMs;
  // Settled once the stream is closed and nothing is still in the air. Until
  // then the telemetry is provisional and must not be minted.
  const settled = !input.pouring && holdMs > 0 && !droplets.some((d) => !d.landed);

  return {
    ...state,
    droplets,
    holdMs: Math.min(holdMs, SIM.maxPourMs),
    dropletsLanded,
    peakVelocity,
    tiltEnergy,
    spawnDebt,
    finished,
    settled,
  };
}

/** What the client reports. The server clamps it again and stores its own result. */
export function telemetryOf(state: PourState): Telemetry {
  return {
    dropletsLanded: state.dropletsLanded,
    peakVelocity: state.peakVelocity,
    tiltEnergy: state.tiltEnergy,
    holdMs: Math.floor(state.holdMs),
  };
}
