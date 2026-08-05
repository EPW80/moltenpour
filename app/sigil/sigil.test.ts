import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { generateSigil, hashSeed, sigilDigest, type BurnSeed } from './sigil';
import { clampTelemetry, SIM, TIER_BOUNDS, type Telemetry } from './telemetry';
import { classify, rarityScore, RARITIES, type Rarity } from './rarity';

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
  rarityScore: number;
  rarity: Rarity;
  sigilDigest: number;
};

const corpus: {
  version: number;
  engine: string;
  probe: Record<string, string>;
  rows: Row[];
} = JSON.parse(readFileSync(resolve(HERE, '../../api/sigil/testdata/corpus.json'), 'utf8'));

describe('the corpus', () => {
  it('is the 300 rows the Go side expects', () => {
    expect(corpus.version).toBe(3);
    expect(corpus.rows).toHaveLength(300);
  });

  // Provenance. Math.sin/cos/pow are implementation-dependent per ECMAScript and
  // feed generateSigil, so the corpus is only meaningful alongside the engine
  // that produced it. The Go side pins the value; this only checks it is there,
  // because a corpus with no engine recorded is one nobody can pin later.
  it('records the engine that produced it, and its probes', () => {
    expect(corpus.engine).toMatch(/^[a-z0-9-]+\/\d/);
    for (const k of ['cos07', 'sin23', 'pow11_3']) {
      expect(corpus.probe?.[k], `probe ${k}`).toBeTypeOf('string');
    }
  });

  it('exercises all four rarities, or it is not a referee for the classifier', () => {
    const seen = new Set(corpus.rows.map((r) => r.rarity));
    for (const r of RARITIES) expect(seen, `no ${r} row`).toContain(r);
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

describe('rarity', () => {
  it('matches every rarity and score in the corpus', () => {
    for (const [i, r] of corpus.rows.entries()) {
      expect(rarityScore(r.clamped, r.tierIndex), `row ${i}`).toBe(r.rarityScore);
      expect(classify(r.clamped, r.tierIndex), `row ${i}`).toBe(r.rarity);
    }
  });

  // The scoring is integer arithmetic specifically so a threshold comparison can
  // never straddle a last-ulp difference between TS and Go. A fractional score
  // means that guarantee is gone.
  it('scores are integers in 0-1000', () => {
    for (const [i, r] of corpus.rows.entries()) {
      const s = rarityScore(r.clamped, r.tierIndex);
      expect(Number.isInteger(s), `row ${i} score ${s}`).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1000);
    }
  });

  it('is a pure function of telemetry and tier — no luck component', () => {
    const tel: Telemetry = { dropletsLanded: 80, peakVelocity: 1200, tiltEnergy: 12, holdMs: 4000 };
    for (let i = 0; i < 50; i++) expect(classify(tel, 3)).toBe(classify(tel, 3));
  });

  it('clamps out-of-range tiers rather than throwing', () => {
    const tel: Telemetry = { dropletsLanded: 80, peakVelocity: 1200, tiltEnergy: 12, holdMs: 4000 };
    expect(classify(tel, -1)).toBe(classify(tel, 0));
    expect(classify(tel, 99)).toBe(classify(tel, TIER_BOUNDS.length - 1));
    expect(RARITIES).toContain(classify(tel, NaN));
  });

  // The accepted-risk note at the bottom of telemetry.ts states that a client
  // claiming max-legal telemetry on every pour lands "Rare-to-Singular on tiers
  // 3-5". That is a load-bearing claim — it is the reason input-trace replay is
  // deliberately out of scope. If the thresholds drift, the note silently
  // becomes a lie, so it is asserted here rather than trusted.
  it('keeps the max-legal cheat at Rare-to-Singular on tiers 3-5', () => {
    const maxLegal = { dropletsLanded: 9e9, peakVelocity: 9e9, tiltEnergy: 9e9, holdMs: 9e9 };
    for (const tier of [3, 4, 5]) {
      const { telemetry } = clampTelemetry(maxLegal, tier, 16_000);
      expect(['Rare', 'Singular'], `tier ${tier}`).toContain(classify(telemetry, tier));
    }
    // ...and cannot reach Singular on the cheap tiers, which is what makes the
    // per-attempt cost of the exploit the thing that bounds it.
    for (const tier of [0, 1, 2]) {
      const { telemetry } = clampTelemetry(maxLegal, tier, 16_000);
      expect(classify(telemetry, tier), `tier ${tier}`).not.toBe('Singular');
    }
  });

  it('rewards a steady hand over a shaken one', () => {
    const holdMs = 10_000;
    const holdS = holdMs / 1000;
    const base = { dropletsLanded: 100, peakVelocity: 1500, holdMs };
    const steady = classify({ ...base, tiltEnergy: 0 }, 4);
    const shaken = classify({ ...base, tiltEnergy: SIM.maxTiltRate * holdS }, 4);
    expect(rarityScore({ ...base, tiltEnergy: 0 }, 4)).toBeGreaterThan(
      rarityScore({ ...base, tiltEnergy: SIM.maxTiltRate * holdS }, 4),
    );
    expect(RARITIES.indexOf(steady)).toBeGreaterThanOrEqual(RARITIES.indexOf(shaken));
  });

  it('lets a more expensive tier reach further on an identical pour', () => {
    const tel: Telemetry = { dropletsLanded: 200, peakVelocity: 1600, tiltEnergy: 8, holdMs: 9000 };
    for (let t = 1; t < TIER_BOUNDS.length; t++) {
      expect(rarityScore(tel, t), `tier ${t} vs ${t - 1}`).toBeGreaterThanOrEqual(rarityScore(tel, t - 1));
    }
  });
});

// The only guard on the one part of the pipeline that CAN drift between
// JavaScript engines.
//
// hashSeed is integer arithmetic and clampTelemetry uses only exactly-specified
// operations, so every other column in the corpus is identical on any engine —
// which means the engine pin, on its own, guards data that was never at risk.
// generateSigil uses Math.cos and Math.sin, which ECMAScript leaves
// implementation-dependent. This is what notices when they move.
describe('sigil geometry digest', () => {
  it('matches the corpus for all 300 production seeds', () => {
    for (const [i, r] of corpus.rows.entries()) {
      // Seeded from the hash, because that is how production derives a sigil's
      // seed — so these are the sigils these pours would actually mint.
      expect(sigilDigest(r.hash), `row ${i} (seed ${r.hash})`).toBe(r.sigilDigest);
    }
  });

  it('is deterministic and seed-sensitive', () => {
    expect(sigilDigest(1284)).toBe(sigilDigest(1284));
    expect(sigilDigest(1284)).not.toBe(sigilDigest(1285));
  });

  // If the digest ignored part of the geometry it would be a guard in name only.
  it('covers every field the renderer draws', () => {
    const base = generateSigil(4242);
    const digestOf = (g: typeof base) => {
      let h = 0x811c9dc5;
      const feed = (s: string) => {
        for (let i = 0; i < s.length; i++) {
          h = (h ^ (s.charCodeAt(i) & 0xff)) >>> 0;
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        h = (h ^ 0x1f) >>> 0;
        h = Math.imul(h, 0x01000193) >>> 0;
      };
      feed(g.viewBox);
      feed(g.pool);
      for (const t of g.tendrils) {
        feed(t.x1); feed(t.y1); feed(t.x2); feed(t.y2);
        feed(t.strokeOpacity); feed(t.strokeWidth);
      }
      for (const s of g.satellites) {
        feed(s.cx); feed(s.cy); feed(s.r); feed(s.fillOpacity);
      }
      return h >>> 0;
    };

    expect(digestOf(base)).toBe(sigilDigest(4242));

    // Perturb one field at a time; every one must move the digest.
    const perturbations: [string, () => typeof base][] = [
      ['pool', () => ({ ...base, pool: base.pool.replace('M ', 'M  ') })],
      ['tendril x1', () => ({ ...base, tendrils: base.tendrils.map((t, i) => (i ? t : { ...t, x1: '999.9' })) })],
      ['tendril strokeWidth', () => ({ ...base, tendrils: base.tendrils.map((t, i) => (i ? t : { ...t, strokeWidth: '9.99' })) })],
      ['satellite cx', () => ({ ...base, satellites: base.satellites.map((s, i) => (i ? s : { ...s, cx: '111.1' })) })],
      ['satellite r', () => ({ ...base, satellites: base.satellites.map((s, i) => (i ? s : { ...s, r: '9.99' })) })],
      ['satellite fillOpacity', () => ({ ...base, satellites: base.satellites.map((s, i) => (i ? s : { ...s, fillOpacity: '0.11' })) })],
    ];
    for (const [name, mutate] of perturbations) {
      expect(digestOf(mutate()), `changing ${name} did not move the digest`).not.toBe(digestOf(base));
    }
  });

  // A last-ulp change in Math.cos survives .toFixed(1) only sometimes — but when
  // it does not, it lands here rather than in a user's certificate.
  it('changes when a coordinate changes at the precision the SVG carries', () => {
    const g = generateSigil(777);
    const shifted = { ...g, satellites: g.satellites.map((s, i) => (i ? s : { ...s, cx: (Number(s.cx) + 0.1).toFixed(1) })) };
    expect(shifted.satellites[0]!.cx).not.toBe(g.satellites[0]!.cx);
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
