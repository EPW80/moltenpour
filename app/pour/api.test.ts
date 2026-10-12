import { describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, assertPourRecord, getPour, listPours, mintPour } from "./api";

const record = {
  id: "p1",
  ledgerPosition: 3,
  tierIndex: 2,
  amountCents: 500,
  timestampMs: 1_700_000_000_000,
  telemetry: { dropletsLanded: 10, peakVelocity: 5, tiltEnergy: 1, holdMs: 4000 },
  violations: [],
  seed: 42,
  rarity: "Rare",
  rarityScore: 0.5,
  serial: "MP-0003",
  batch: "B-1",
  massGrams: 12.5,
  issued: "2026-10-12",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fast = { backoffMs: 0 };

describe("apiFetch", () => {
  it("retries a GET on 503 and returns the later success", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockResolvedValueOnce(json(record));
    await expect(getPour("p1", { ...fast, fetch: f })).resolves.toMatchObject({ id: "p1" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400, and uses the server's message", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "tier not offered" }, 400));
    const err = await getPour("p1", { ...fast, fetch: f }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "client", status: 400, retryable: false, message: "tier not offered" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("maps 409 to conflict and does not retry", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "tier mismatch" }, 409));
    const err = await apiFetch("/x", {}, { ...fast, fetch: f }).catch((e) => e);
    expect(err).toMatchObject({ code: "conflict", retryable: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never echoes statusText or a non-JSON body", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>nginx secret</html>", { status: 502, statusText: "Bad Gateway" }));
    const err = await apiFetch("/x", {}, { ...fast, retries: 0, fetch: f }).catch((e) => e);
    expect(err).toMatchObject({ code: "server", retryable: true });
    expect(err.message).not.toMatch(/nginx|Bad Gateway|502/);
  });

  it("reports a timeout as retryable and retries it", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("t", "TimeoutError"));
    const err = await apiFetch("/x", {}, { ...fast, fetch: f }).catch((e) => e);
    expect(err).toMatchObject({ code: "timeout", retryable: true });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("reports a rejected fetch as a retryable network error", async () => {
    const f = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await apiFetch("/x", {}, { ...fast, retries: 0, fetch: f }).catch((e) => e);
    expect(err).toMatchObject({ code: "network", retryable: true });
    expect(err.message).not.toMatch(/Failed to fetch/);
  });

  it("prefixes the base and sends the supplied headers", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json(record));
    await getPour("a/b", { base: "http://h:1", headers: { cookie: "mp_owner=x" }, fetch: f });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://h:1/api/pours/a%2Fb");
    expect((init?.headers as Record<string, string>).cookie).toBe("mp_owner=x");
  });
});

describe("record guard", () => {
  it("throws on a malformed record body", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ ...record, rarity: "Mythic" }));
    await expect(getPour("p1", { ...fast, fetch: f })).rejects.toMatchObject({ code: "server" });
  });

  it("throws when a nested telemetry field is missing", () => {
    expect(() => assertPourRecord({ ...record, telemetry: { holdMs: 1 } })).toThrow(/telemetry/);
  });

  it("rejects a listing that is not an array", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(json({ pours: [] }));
    await expect(listPours({ ...fast, fetch: f })).rejects.toBeInstanceOf(ApiError);
  });
});

describe("mintPour", () => {
  it("posts JSON and retries after a network failure", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("x"))
      .mockResolvedValueOnce(json(record, 200));
    const req = { tierIndex: 2, timestampMs: 1, telemetry: record.telemetry };
    await expect(mintPour(req, { ...fast, fetch: f })).resolves.toMatchObject({ id: "p1" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][1]?.method).toBe("POST");
    expect(f.mock.calls[1][1]?.body).toBe(JSON.stringify(req));
  });
});
