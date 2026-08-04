/**
 * record.ts — the pour record, and the client's view of the API
 *
 * The certificate is a render target: pour record in, sheet out. Every value it
 * prints comes from here.
 *
 * IMPORTANT: the derived strings (serial, batch, mass) are computed by the
 * server, not here. They could be derived on both sides, but that would be a
 * third thing to keep in agreement across two languages on top of the hash and
 * the rarity — and unlike those two, nothing about the product requires the
 * client to know them before minting. The client renders what it is given.
 */

import type { Rarity } from '../sigil/rarity';
import type { Telemetry } from '../sigil/telemetry';

export type PourRecord = {
  id: string;
  /** Position in the ledger, 1-based. The №1,284 on the certificate. */
  ledgerPosition: number;
  tierIndex: number;
  amountCents: number;
  timestampMs: number;
  /** Server-clamped. Never the raw client claim. */
  telemetry: Telemetry;
  /** Fields the client overclaimed. Non-empty is a cheat signal worth logging. */
  violations: string[];
  seed: number;
  rarity: Rarity;
  rarityScore: number;

  serial: string;
  batch: string;
  massGrams: number;
  /** ISO YYYY-MM-DD. Never localized — the deadpan register depends on it. */
  issued: string;
};

export type MintRequest = {
  tierIndex: number;
  /**
   * Pour-start, chosen by the CLIENT.
   *
   * IMPORTANT: this feeds the seed hash, so the server cannot invent it — a
   * server-side timestamp would guarantee the minted sigil differed from the one
   * the user watched form. The server bounds it to a clock-skew window and
   * derives the wall clock from it, so a client cannot claim a longer pour than
   * the time it actually let elapse before posting.
   */
  timestampMs: number;
  telemetry: Telemetry;
};

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export async function mintPour(req: MintRequest): Promise<PourRecord> {
  return json<PourRecord>(
    await fetch('/api/pours', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  );
}

export async function listPours(): Promise<PourRecord[]> {
  return json<PourRecord[]>(await fetch('/api/pours'));
}

export async function getPour(id: string): Promise<PourRecord> {
  return json<PourRecord>(await fetch(`/api/pours/${encodeURIComponent(id)}`));
}

/** `310.97 g` — two decimals and a space, per the certificate spec. */
export function formatMass(grams: number): string {
  return `${grams.toFixed(2)} g`;
}

/** `No. 1,284` — thousands separator and the prefix are both part of the copy. */
export function formatLedgerPosition(position: number): string {
  return `No. ${position.toLocaleString('en-US')}`;
}

/** `№1,284` for the caption and the gallery tile. */
export function formatOrdinal(position: number): string {
  return `№${position.toLocaleString('en-US')}`;
}
