import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { generateSigil, hashSeed, type BurnSeed } from './sigil';
import { clampTelemetry, type Telemetry } from './telemetry';

const HERE = dirname(fileURLToPath(import.meta.url));

type Row = {
  tierIndex: number;
  wallClockMs: number;
  raw: Telemetry;
  timestampMs: number;
  amountCents: number;
  clamped: Telemetry;
  violations: string[];
  hash: number;
};

const corpus: { version: number; rows: Row[] } = JSON.parse(
  readFileSync(resolve(HERE, '../../api/sigil/testdata/corpus.json'), 'utf8'),
);

describe('the corpus', () => {
  it('is the 300 rows the Go side expects', () => {
    expect(corpus.version).toBe(1);
    expect(corpus.rows).toHaveLength(300);
  });
});

// The mirror of TestHashMatchesTypeScript in api/sigil/sigil_test.go. Go proves
// it agrees with the committed corpus; this proves the TypeScript that generated
// the corpus still agrees with it too. Without this, a change to hashSeed is only
// caught after someone regenerates.
describe('hashSeed', () => {
  it('matches every hash in the corpus', () => {
    for (const [i, r] of corpus.rows.entries()) {
      const seed: BurnSeed = {
        tierIndex: r.tierIndex,
        amountCents: r.amountCents,
        timestampMs: r.timestampMs,
        telemetry: r.clamped,
      };
      expect(hashSeed(seed), `row ${i}`).toBe(r.hash);
    }
  });

  it('is stable for non-finite telemetry, in case a caller bypassed the clamp', () => {
    const seed: BurnSeed = {
      tierIndex: 2,
      amountCents: 999,
      timestampMs: 1_750_000_000_000,
      telemetry: {
        dropletsLanded: NaN,
        peakVelocity: Infinity,
        tiltEnergy: NaN,
        holdMs: 5000,
      },
    };
    expect(hashSeed(seed)).toBe(hashSeed(seed));
  });

  it('changes when any single field changes', () => {
    const base: BurnSeed = {
      tierIndex: 3,
      amountCents: 2499,
      timestampMs: 1_750_000_000_000,
      telemetry: { dropletsLanded: 80, peakVelocity: 1200.5, tiltEnergy: 12.25, holdMs: 4000 },
    };
    const h = hashSeed(base);
    expect(hashSeed({ ...base, tierIndex: 4 })).not.toBe(h);
    expect(hashSeed({ ...base, amountCents: 4999 })).not.toBe(h);
    expect(hashSeed({ ...base, timestampMs: base.timestampMs + 1 })).not.toBe(h);
    expect(hashSeed({ ...base, telemetry: { ...base.telemetry, dropletsLanded: 81 } })).not.toBe(h);
    // tiltEnergy is hashed at 1000x, so a thousandth is the resolution floor.
    expect(hashSeed({ ...base, telemetry: { ...base.telemetry, tiltEnergy: 12.251 } })).not.toBe(h);
  });
});

describe('clampTelemetry', () => {
  it('matches every clamped row and violation list in the corpus', () => {
    for (const [i, r] of corpus.rows.entries()) {
      const got = clampTelemetry(r.raw, r.tierIndex, r.wallClockMs);
      expect(got.telemetry, `row ${i}`).toEqual(r.clamped);
      expect([...got.violations].sort(), `row ${i}`).toEqual([...r.violations].sort());
    }
  });
});

// The invariant the certificate handoff asks for by name. The viewBox is
// 0 0 400 400 with overflow:hidden, so anything outside the box is silently
// sliced flat rather than erroring — exactly the kind of break nobody notices
// until it is on a printed certificate.
describe('generateSigil geometry', () => {
  it('keeps every coordinate inside the viewBox for seeds 1-9999', () => {
    const MIN = 2;
    const MAX = 398;
    let worstLow = Infinity;
    let worstHigh = -Infinity;

    for (let seed = 1; seed <= 9999; seed++) {
      const g = generateSigil(seed);

      for (const t of g.tendrils) {
        for (const v of [t.x1, t.y1, t.x2, t.y2].map(Number)) {
          worstLow = Math.min(worstLow, v);
          worstHigh = Math.max(worstHigh, v);
          expect(v, `seed ${seed} tendril`).toBeGreaterThanOrEqual(MIN);
          expect(v, `seed ${seed} tendril`).toBeLessThanOrEqual(MAX);
        }
      }

      for (const s of g.satellites) {
        // A circle's extent, not just its centre — the radius is what pushes it out.
        const cx = Number(s.cx);
        const cy = Number(s.cy);
        const r = Number(s.r);
        for (const v of [cx - r, cx + r, cy - r, cy + r]) {
          worstLow = Math.min(worstLow, v);
          worstHigh = Math.max(worstHigh, v);
          expect(v, `seed ${seed} satellite`).toBeGreaterThanOrEqual(MIN);
          expect(v, `seed ${seed} satellite`).toBeLessThanOrEqual(MAX);
        }
      }
    }

    // Surfaced so a future change that eats the headroom is visible in the log
    // rather than only failing once it has already crossed the line.
    console.log(`seeds 1-9999: coordinates span ${worstLow.toFixed(1)}…${worstHigh.toFixed(1)} of 0…400`);
  });

  it('is deterministic — same seed, same geometry', () => {
    expect(generateSigil(1284)).toEqual(generateSigil(1284));
  });

  it('gives different seeds different geometry', () => {
    expect(generateSigil(1284).pool).not.toBe(generateSigil(1285).pool);
  });

  it('emits the fixed structure the certificate lays out around', () => {
    const g = generateSigil(1284);
    expect(g.tendrils).toHaveLength(9);
    expect(g.satellites).toHaveLength(26);
    expect(g.viewBox).toBe('0 0 400 400');
    // Seed-suffixed so several sigils on one page don't collide.
    expect(g.gradientId).toBe('pool-1284');
    expect(g.pool.startsWith('M ')).toBe(true);
    expect(g.pool.endsWith(' Z')).toBe(true);
  });
});
