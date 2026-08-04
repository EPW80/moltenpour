/**
 * sigil.ts — the seed hash and the splatter geometry
 *
 * Shared by the app and the Go API (port, don't fork — see app/sigil/CLAUDE.md).
 *
 * `hashSeed` is duplicated in api/sigil/sigil.go. TypeScript is the source of
 * truth; Go conforms to it, and testdata/corpus.json is the referee. A drift
 * between the two does not crash — it mints a sigil that differs from the one
 * the user watched form on their screen.
 *
 * `generateSigil` is TS-only. The server stores the seed and the rarity; it does
 * not render geometry.
 */

import type { Telemetry } from './telemetry';

export type BurnSeed = {
  tierIndex: number;
  amountCents: number;
  timestampMs: number;
  telemetry: Telemetry;
};

// ---------------------------------------------------------------------------
// Seed hashing
// ---------------------------------------------------------------------------

/**
 * FNV-1a over a fixed field order.
 *
 * IMPORTANT: the field list is a slice, never an object's keys. Key order is
 * undefined and would drift per run and per language.
 *
 * `>>> 0` is the ECMAScript ToUint32 operation: it truncates toward zero and
 * wraps modulo 2^32, and yields 0 for NaN and Infinity. Go's toUint32 replicates
 * it explicitly, because converting a non-finite float to an integer type in Go
 * is implementation-specific per the spec.
 */
export function hashSeed(seed: BurnSeed): number {
  const t = seed.telemetry;
  const parts = [
    seed.tierIndex >>> 0,
    seed.amountCents >>> 0,
    seed.timestampMs >>> 0,
    t.dropletsLanded >>> 0,
    Math.round(t.peakVelocity) >>> 0,
    Math.round(t.tiltEnergy * 1000) >>> 0,
    t.holdMs >>> 0,
  ];

  let h = 0x811c9dc5;
  for (const p of parts) {
    for (let b = 0; b < 4; b++) {
      h = (h ^ ((p >>> (b * 8)) & 0xff)) >>> 0;
      // Math.imul wraps at 32 bits. Go's native uint32 multiply wraps
      // identically — but do not widen h to a wider type "for safety" on
      // either side, which silently stops the wraparound the hash depends on.
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Where the sigil is drawn. The viewBox is fixed; see CLIP_RADIUS. */
const CX = 200;
const CY = 200;
const BASE = 74;
const VIEWBOX = 400;

/**
 * Tendril endpoints are capped here.
 *
 * IMPORTANT: the viewBox is 0 0 400 400 rendered with overflow:hidden, so any
 * endpoint past 200 units from center gets sliced flat. 194 leaves the stroke
 * width its own headroom. Verified: max coordinate 394 of 400 across seeds.
 */
const CLIP_RADIUS = 194;

/**
 * mulberry32. Seeded PRNG — no Math.random() anywhere, because the sigil is the
 * artifact the user owns and must be reproducible from the pour record rather
 * than re-rolled at render time.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 12 lobes at even angles, joined into a closed quadratic path through the
 * segment midpoints — a smooth irregular blob, not a polygon.
 */
function poolPath(r: () => number, cx: number, cy: number, base: number): string {
  const N = 12;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rad = base * (0.74 + r() * 0.44);
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }

  let d = '';
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    d += i === 0 ? `M ${m[0].toFixed(1)} ${m[1].toFixed(1)}` : '';
    const n = pts[(i + 1) % N];
    const nn = pts[(i + 2) % N];
    const m2 = [(n[0] + nn[0]) / 2, (n[1] + nn[1]) / 2];
    d += ` Q ${q[0].toFixed(1)} ${q[1].toFixed(1)} ${m2[0].toFixed(1)} ${m2[1].toFixed(1)}`;
  }
  return d + ' Z';
}

/** A tendril: a straight line from the pool edge outward. */
export type Tendril = {
  x1: string; y1: string; x2: string; y2: string;
  strokeOpacity: string; strokeWidth: string;
};

/** A satellite: a droplet that landed clear of the pool. */
export type Satellite = {
  cx: string; cy: string; r: string; fillOpacity: string;
};

/** Everything needed to draw a sigil, with no rendering library involved. */
export type SigilGeometry = {
  seed: number;
  viewBox: string;
  /** Gradient id, seed-suffixed so several sigils on one page don't collide. */
  gradientId: string;
  pool: string;
  tendrils: Tendril[];
  satellites: Satellite[];
};

/**
 * One integer seed → identical geometry every time.
 *
 * IMPORTANT: the draw order is pool → tendrils → satellites, and the random
 * draws are consumed in that order. The sequence is a stable output format:
 * reordering the draws changes every sigil that has already been minted.
 */
export function generateSigil(seed: number): SigilGeometry {
  const r = rng(seed);

  const pool = poolPath(r, CX, CY, BASE);

  const tendrils: Tendril[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.18;
    const r0 = BASE * 0.94;
    const r1 = Math.min(CLIP_RADIUS, r0 + 32 + r() * 100);
    tendrils.push({
      x1: (CX + Math.cos(a) * r0).toFixed(1),
      y1: (CY + Math.sin(a) * r0).toFixed(1),
      x2: (CX + Math.cos(a) * r1).toFixed(1),
      y2: (CY + Math.sin(a) * r1).toFixed(1),
      strokeOpacity: (0.5 + r() * 0.4).toFixed(2),
      strokeWidth: (0.7 + r() * 2.1).toFixed(2),
    });
  }

  const satellites: Satellite[] = [];
  for (let i = 0; i < 26; i++) {
    // Near-symmetrical spacing is deliberate: this jitter is small because an
    // even ring is the story a steady pour tells.
    const a = (i / 26) * Math.PI * 2 + (r() - 0.5) * 0.08;
    const rad = BASE + 42 + r() * 74;
    satellites.push({
      cx: (CX + Math.cos(a) * rad).toFixed(1),
      cy: (CY + Math.sin(a) * rad).toFixed(1),
      r: (1.9 + r() * 4.6).toFixed(2),
      fillOpacity: (0.55 + r() * 0.4).toFixed(2),
    });
  }

  return {
    seed,
    viewBox: `0 0 ${VIEWBOX} ${VIEWBOX}`,
    gradientId: `pool-${seed}`,
    pool,
    tendrils,
    satellites,
  };
}
