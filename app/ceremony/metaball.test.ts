import { afterEach, describe, expect, it, vi } from "vitest";

import { backingSize } from "./metaball";

/** Only clientWidth/clientHeight are read — a full canvas is not needed. */
function fakeCanvas(clientWidth: number, clientHeight: number): HTMLCanvasElement {
  return { clientWidth, clientHeight } as unknown as HTMLCanvasElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backingSize", () => {
  it("scales the CSS size by devicePixelRatio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    expect(backingSize(fakeCanvas(300, 200))).toEqual({ width: 600, height: 400 });
  });

  it("caps the ratio at 2 even on a higher-DPR device", () => {
    vi.stubGlobal("window", { devicePixelRatio: 3 });
    expect(backingSize(fakeCanvas(300, 200))).toEqual({ width: 600, height: 400 });
  });

  it("falls back to a ratio of 1 when devicePixelRatio is falsy", () => {
    vi.stubGlobal("window", { devicePixelRatio: 0 });
    expect(backingSize(fakeCanvas(300, 200))).toEqual({ width: 300, height: 200 });
  });

  it("floors at 1px so a zero-size canvas never backs a zero-size buffer", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    expect(backingSize(fakeCanvas(0, 0))).toEqual({ width: 1, height: 1 });
  });

  it("rounds a fractional device-pixel size", () => {
    vi.stubGlobal("window", { devicePixelRatio: 1.5 });
    expect(backingSize(fakeCanvas(301, 201))).toEqual({ width: 452, height: 302 });
  });
});
