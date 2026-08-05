import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashSeed, sigilDigest, type BurnSeed } from './sigil';
import { clampTelemetry } from './telemetry';
import { classify, rarityScore } from './rarity';
// The generator is a dev script, not part of the ported core, so it may reach up
// into the app layer for the prices rather than keeping a second copy of them.
import { tierAt } from '../ceremony/tiers';

// Written straight to where the Go test reads it, resolved from this file
// rather than the CWD so the script works from anywhere. There is no separate
// copy step: a corpus sitting next to the generator instead of in testdata is a
// corpus the Go side never checks.
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../api/sigil/testdata/corpus.json');

// ---------------------------------------------------------------------------
// Engine provenance
// ---------------------------------------------------------------------------

/**
 * Which JavaScript engine produced this corpus.
 *
 * Math.sin/cos/pow are implementation-dependent per ECMAScript and feed
 * generateSigil, so a corpus is only meaningful alongside the engine that
 * generated it. See app/sigil/ENGINE-PINNING.md.
 */
const v = process.versions as Record<string, string>;
const engine = v.bun ? `bun/${v.bun}`
  : v.v8 ? `node-v8/${v.v8.split('-')[0]}`
  : 'unknown';

const PINNED = 'node-v8';

/**
 * IMPORTANT: refuse rather than warn.
 *
 * Regenerating on another engine is a contract change, not a refresh. Without
 * this the failure surfaces much later, in a Go test, after the corpus has
 * already been written and possibly committed — and `bun run gencorpus` is one
 * keystroke away from doing it silently. The flag exists so a deliberate engine
 * change is still possible; it just has to be deliberate.
 */
if (!engine.startsWith(PINNED + '/') && !process.argv.includes('--allow-engine-change')) {
  console.error(
    `refusing to write the corpus: running on ${engine}, pinned to ${PINNED}/*.\n` +
      `The rows would very likely be identical — but generateSigil uses Math.cos/sin,\n` +
      `which ECMAScript leaves implementation-dependent, so this is a contract change.\n` +
      `Read app/sigil/ENGINE-PINNING.md. To do it on purpose:\n` +
      `  npm run gencorpus -- --allow-engine-change`,
  );
  process.exit(1);
}

let a = 0x5eed1234;
const next = () => { a=(a+0x6d2b79f5)>>>0; let t=a; t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };

const rows: any[] = [];
for (let i = 0; i < 300; i++) {
  const tierIndex = i % 6;
  // Deliberately include overclaims, zeros, and boundary values.
  const wild = i % 7 === 0;
  const raw = {
    dropletsLanded: wild ? 9e9 : Math.floor(next()*140),
    peakVelocity:  wild ? 9e9 : next()*2600,
    tiltEnergy:    wild ? 9e9 : next()*5,
    holdMs:        wild ? 9e9 : Math.floor(next()*16000),
  };
  const wallClockMs = 500 + Math.floor(next()*16000);
  const c = clampTelemetry(raw, tierIndex, wallClockMs);
  const seed: BurnSeed = {
    tierIndex, amountCents: tierAt(tierIndex).amountCents,
    timestampMs: 1_750_000_000_000 + i*97_003,
    telemetry: c.telemetry,
  };
  const hash = hashSeed(seed);
  rows.push({ tierIndex, wallClockMs, raw, timestampMs: seed.timestampMs,
    amountCents: seed.amountCents,
    clamped: c.telemetry, violations: c.violations.slice().sort(),
    hash,
    // Rarity is previewed on the client and minted on the server, so it carries
    // the same drift risk as the hash and gets the same referee.
    rarityScore: rarityScore(c.telemetry, tierIndex),
    rarity: classify(c.telemetry, tierIndex),
    // The geometry the hash actually produces. Seeded from the hash because that
    // is how production derives a sigil's seed, so these are the 300 sigils real
    // pours of this shape would mint — and the only column here that a change of
    // JavaScript engine can move.
    sigilDigest: sigilDigest(hash) });
}

// No generatedAt. It would differ on every run, and CI regenerates the corpus
// and fails on any diff — the timestamp alone would break the drift guard. Git
// already records when this file changed and who changed it.
writeFileSync(OUT, JSON.stringify({
  version: 3,
  engine,
  probe: {
    cos07: Math.cos(0.7).toString(),
    sin23: Math.sin(2.3).toString(),
    pow11_3: Math.pow(1.1, 3).toString(),
  },
  rows,
}, null, 1));

console.log('engine', engine, '| rows', rows.length, '| sample hash', rows[0].hash, '| clamped[0]', JSON.stringify(rows[0].clamped));
const spread = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.rarity]: (a[r.rarity] ?? 0) + 1 }), {});
console.log('rarity spread', JSON.stringify(spread));
console.log('wrote', OUT);
