import { describe, expect, it } from "vitest";

import { formatLedgerPosition, formatMass, formatOrdinal } from "./record";

describe("formatMass", () => {
  it("prints grams to two decimals with a unit", () => {
    expect(formatMass(310.9666)).toBe("310.97 g");
  });

  it("pads a whole number to two decimals", () => {
    expect(formatMass(4)).toBe("4.00 g");
  });

  it("prints zero mass, not a blank", () => {
    expect(formatMass(0)).toBe("0.00 g");
  });
});

describe("formatLedgerPosition", () => {
  it("prefixes with No. and a thousands separator", () => {
    expect(formatLedgerPosition(1284)).toBe("No. 1,284");
  });

  it("has no separator below a thousand", () => {
    expect(formatLedgerPosition(7)).toBe("No. 7");
  });
});

describe("formatOrdinal", () => {
  it("prefixes with the ordinal glyph and a thousands separator", () => {
    expect(formatOrdinal(1284)).toBe("№1,284");
  });

  it("has no separator below a thousand", () => {
    expect(formatOrdinal(7)).toBe("№7");
  });
});
