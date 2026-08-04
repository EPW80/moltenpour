import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashSeed, type BurnSeed } from './sigil';
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
  rows.push({ tierIndex, wallClockMs, raw, timestampMs: seed.timestampMs,
    amountCents: seed.amountCents,
    clamped: c.telemetry, violations: c.violations.slice().sort(),
    hash: hashSeed(seed),
    // Rarity is previewed on the client and minted on the server, so it carries
    // the same drift risk as the hash and gets the same referee.
    rarityScore: rarityScore(c.telemetry, tierIndex),
    rarity: classify(c.telemetry, tierIndex) });
}
writeFileSync(OUT, JSON.stringify({ version: 2, rows }, null, 1));
console.log('rows', rows.length, '| sample hash', rows[0].hash, '| clamped[0]', JSON.stringify(rows[0].clamped));
const spread = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.rarity]: (a[r.rarity] ?? 0) + 1 }), {});
console.log('rarity spread', JSON.stringify(spread));
console.log('wrote', OUT);
