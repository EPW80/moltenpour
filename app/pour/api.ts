/**
 * api.ts — the one typed client for the ledger API
 *
 * Everything that talks to the server goes through apiFetch: the app, and the
 * certificate script in Node. It owns the base URL, the timeout, the bounded
 * retry, and the shape of a failure, so no caller sees a bare fetch error, a
 * statusText, or a raw response body.
 *
 * Retrying is safe for every call here, including the mint: the server mints
 * idempotently on (owner, timestampMs), so a replay returns the same record.
 */

import { RARITIES } from "../sigil/rarity";
import type { MintRequest, PourRecord, ServerConfig } from "./record";

/**
 * network   the request never got an answer (offline, refused, reset)
 * timeout   no answer inside the budget
 * client    the server refused the request; sending it again will not help
 * server    the server failed; it may succeed on another attempt
 * conflict  the request contradicts what the ledger already holds (409)
 */
export type ApiErrorCode = "network" | "timeout" | "client" | "server" | "conflict";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryable = code === "network" || code === "timeout" || code === "server";
  }
}

export type ApiOptions = {
  /** Per-attempt budget. */
  timeoutMs?: number;
  /** Extra attempts after the first. */
  retries?: number;
  /** Overrides VITE_API_BASE. `""` is same-origin. */
  base?: string;
  /** Sent on every attempt. The certificate script passes the owner cookie here. */
  headers?: Record<string, string>;
  /** First backoff; doubles each retry. */
  backoffMs?: number;
  fetch?: typeof fetch;
};

const READ_TIMEOUT_MS = 10_000;
/**
 * Mint outlasts the server's 10s SQLite busy_timeout with slack, so a slow
 * ledger answers before the client gives up.
 */
const MINT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 300;

/** Vite inlines this in the app; under Node there is no `env`, so it is "". */
function defaultBase(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_API_BASE ?? "";
}

/** The server's own words, or a fixed line per code. Never statusText or the raw body. */
const FALLBACK: Record<ApiErrorCode, string> = {
  network: "The ledger could not be reached.",
  timeout: "The ledger did not answer.",
  client: "The ledger refused the request.",
  server: "The ledger failed to process the request.",
  conflict: "The request conflicts with the ledger.",
};

async function serverMessage(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const msg = (body as { error: unknown }).error;
      if (typeof msg === "string" && msg !== "") return msg;
    }
  } catch {
    // Not JSON (a proxy's HTML page, say). Fall back to the fixed line.
  }
  return undefined;
}

async function failureFor(res: Response): Promise<ApiError> {
  const code: ApiErrorCode =
    res.status === 409 ? "conflict" : res.status >= 500 ? "server" : "client";
  return new ApiError(code, res.status, (await serverMessage(res)) ?? FALLBACK[code]);
}

function isTimeout(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "TimeoutError" || e.name === "AbortError")
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves to the successful Response, or throws an ApiError. */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
  opts: ApiOptions = {},
): Promise<Response> {
  const {
    timeoutMs = READ_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    base = defaultBase(),
    headers,
    backoffMs = DEFAULT_BACKOFF_MS,
    fetch: doFetch = fetch,
  } = opts;

  let last: ApiError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs * 2 ** (attempt - 1));
    try {
      const res = await doFetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      last = await failureFor(res);
    } catch (e) {
      last = isTimeout(e)
        ? new ApiError("timeout", 0, FALLBACK.timeout)
        : new ApiError("network", 0, FALLBACK.network);
    }
    if (!last.retryable) break;
  }
  throw last as ApiError;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Hand-written guard over the fields in api/pour/pour.go. A schema library
 * would be a dependency for one struct; this fails loudly if the server's shape
 * drifts, instead of rendering `undefined` onto a certificate.
 */
export function assertPourRecord(x: unknown): asserts x is PourRecord {
  const bad = (field: string): never => {
    throw new ApiError("server", 0, `The ledger returned a malformed record (${field}).`);
  };
  if (!isObject(x)) return bad("record");
  for (const f of ["id", "serial", "batch", "issued"])
    if (typeof x[f] !== "string") bad(f);
  for (const f of [
    "ledgerPosition",
    "tierIndex",
    "amountCents",
    "timestampMs",
    "seed",
    "rarityScore",
    "massGrams",
  ])
    if (typeof x[f] !== "number" || !Number.isFinite(x[f])) bad(f);
  if (!(RARITIES as readonly unknown[]).includes(x.rarity)) bad("rarity");
  if (!Array.isArray(x.violations) || x.violations.some((v) => typeof v !== "string"))
    bad("violations");
  const t = x.telemetry;
  if (!isObject(t)) return bad("telemetry");
  for (const f of ["dropletsLanded", "peakVelocity", "tiltEnergy", "holdMs"])
    if (typeof t[f] !== "number" || !Number.isFinite(t[f])) bad(`telemetry.${f}`);
}

async function jsonBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ApiError("server", res.status, "The ledger returned an unreadable answer.");
  }
}

export async function mintPour(req: MintRequest, opts: ApiOptions = {}): Promise<PourRecord> {
  const res = await apiFetch(
    "/api/pours",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    },
    { timeoutMs: MINT_TIMEOUT_MS, ...opts },
  );
  const record = await jsonBody(res);
  assertPourRecord(record);
  return record;
}

export async function listPours(opts: ApiOptions = {}): Promise<PourRecord[]> {
  const list = await jsonBody(await apiFetch("/api/pours", {}, opts));
  if (!Array.isArray(list))
    throw new ApiError("server", 0, "The ledger returned a malformed listing.");
  list.forEach(assertPourRecord);
  return list;
}

export async function getPour(id: string, opts: ApiOptions = {}): Promise<PourRecord> {
  const record = await jsonBody(
    await apiFetch(`/api/pours/${encodeURIComponent(id)}`, {}, opts),
  );
  assertPourRecord(record);
  return record;
}

export async function getConfig(opts: ApiOptions = {}): Promise<ServerConfig> {
  const config = await jsonBody(await apiFetch("/api/config", {}, opts));
  if (!isObject(config) || typeof config.maxTierIndex !== "number")
    throw new ApiError("server", 0, "The ledger returned a malformed configuration.");
  return config as ServerConfig;
}
