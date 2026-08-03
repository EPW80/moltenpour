import { writeFileSync } from 'node:fs';
import { hashSeed, type BurnSeed } from './sigil';
import { clampTelemetry } from './telemetry';

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
    tierIndex, amountCents: [0,299,999,2499,4999,9999][tierIndex],
    timestampMs: 1_750_000_000_000 + i*97_003,
    telemetry: c.telemetry,
  };
  rows.push({ tierIndex, wallClockMs, raw, timestampMs: seed.timestampMs,
    amountCents: seed.amountCents,
    clamped: c.telemetry, violations: c.violations.slice().sort(),
    hash: hashSeed(seed) });
}
writeFileSync('corpus.json', JSON.stringify({ version: 1, rows }, null, 1));
console.log('rows', rows.length, '| sample hash', rows[0].hash, '| clamped[0]', JSON.stringify(rows[0].clamped));
