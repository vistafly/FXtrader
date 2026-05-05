import { describe, expect, it } from "vitest";

import { isMarketOpen, nextMarketOpen } from "./sessionHours";

/** Helper: build a UTC unix-second timestamp from a Y/M/D h:m string. */
function utc(y: number, m: number, d: number, h: number, min = 0): number {
  return Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);
}

describe("isMarketOpen — forex", () => {
  it("Monday 12:00 UTC → open", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 5, 12))).toBe(true);
  });

  it("Friday 21:59 UTC → open (just before close)", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 9, 21, 59))).toBe(true);
  });

  it("Friday 22:00 UTC → closed (close boundary)", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 9, 22))).toBe(false);
  });

  it("Saturday 12:00 UTC → closed", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 10, 12))).toBe(false);
  });

  it("Sunday 21:59 UTC → closed (just before open)", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 11, 21, 59))).toBe(false);
  });

  it("Sunday 22:00 UTC → open (open boundary)", () => {
    expect(isMarketOpen("EURUSD", utc(2026, 1, 11, 22))).toBe(true);
  });
});

describe("isMarketOpen — cme-futures", () => {
  it("Monday 12:00 UTC → open", () => {
    expect(isMarketOpen("NQ1!", utc(2026, 1, 5, 12))).toBe(true);
  });

  it("Sunday 22:30 UTC → closed (forex open but CME still closed)", () => {
    expect(isMarketOpen("NQ1!", utc(2026, 1, 11, 22, 30))).toBe(false);
  });

  it("Sunday 23:00 UTC → open (CME open boundary)", () => {
    expect(isMarketOpen("NQ1!", utc(2026, 1, 11, 23))).toBe(true);
  });

  it("Friday 22:00 UTC → closed", () => {
    expect(isMarketOpen("NQ1!", utc(2026, 1, 9, 22))).toBe(false);
  });
});

describe("isMarketOpen — defensive fallback", () => {
  it("returns undefined for an unknown instrument", () => {
    expect(isMarketOpen("FAKE/PAIR", utc(2026, 1, 5, 12))).toBeUndefined();
  });
});

describe("nextMarketOpen", () => {
  it("Saturday 12:00 → returns Sunday 22:00 (forex)", () => {
    const next = nextMarketOpen("EURUSD", utc(2026, 1, 10, 12));
    expect(next).toBe(utc(2026, 1, 11, 22));
  });

  it("Sunday 12:00 → returns Sunday 22:00 (forex same-day)", () => {
    const next = nextMarketOpen("EURUSD", utc(2026, 1, 11, 12));
    expect(next).toBe(utc(2026, 1, 11, 22));
  });

  it("Saturday 12:00 → returns Sunday 23:00 (CME)", () => {
    const next = nextMarketOpen("NQ1!", utc(2026, 1, 10, 12));
    expect(next).toBe(utc(2026, 1, 11, 23));
  });

  it("returns undefined when market is currently open", () => {
    expect(nextMarketOpen("EURUSD", utc(2026, 1, 5, 12))).toBeUndefined();
  });

  it("returns undefined for unknown instrument", () => {
    expect(nextMarketOpen("FAKE", utc(2026, 1, 10, 12))).toBeUndefined();
  });
});
