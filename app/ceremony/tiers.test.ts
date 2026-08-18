import { describe, expect, it } from "vitest";

import { formatConsideration, formatUSD } from "./tiers";

describe("formatUSD", () => {
  it("prints cents as a two-decimal dollar figure with no currency glyph", () => {
    expect(formatUSD(9999)).toBe("USD 99.99");
    expect(formatUSD(299)).toBe("USD 2.99");
  });

  it("pads a whole-dollar amount to two decimals", () => {
    expect(formatUSD(100)).toBe("USD 1.00");
  });

  it("does not special-case zero — a sum of zero is USD 0.00, not Free", () => {
    expect(formatUSD(0)).toBe("USD 0.00");
  });
});

describe("formatConsideration", () => {
  it("reads Free at zero", () => {
    expect(formatConsideration(0)).toBe("Free");
  });

  it("also reads Free below zero, since a tier's own price is never negative", () => {
    expect(formatConsideration(-1)).toBe("Free");
  });

  it("otherwise defers to formatUSD", () => {
    expect(formatConsideration(2499)).toBe(formatUSD(2499));
    expect(formatConsideration(2499)).toBe("USD 24.99");
  });
});
