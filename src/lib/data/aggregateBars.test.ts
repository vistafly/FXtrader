import { describe, expect, it } from "vitest";

import type { Bar } from "@/types/bar";

import { aggregateBars } from "./aggregateBars";

const make1m = (count: number, startTs = 1_700_000_000): Bar[] =>
  Array.from({ length: count }, (_, i) => ({
    time: startTs + i * 60,
    open: 100 + i,
    high: 100 + i + 0.5,
    low: 100 + i - 0.5,
    close: 100 + i + 0.2,
    volume: 10 + i,
  }));

describe("aggregateBars — basics", () => {
  it("returns identity for timeframe = 1", () => {
    const bars = make1m(10);
    const out = aggregateBars(bars, 1);
    expect(out).toEqual(bars);
    // Should be a fresh array (slice), not the same reference
    expect(out).not.toBe(bars);
  });

  it("returns [] for empty input", () => {
    expect(aggregateBars([], 5)).toEqual([]);
  });

  it("rejects non-positive timeframe", () => {
    expect(() => aggregateBars([], 0)).toThrow();
    expect(() => aggregateBars([], -5)).toThrow();
  });
});

describe("aggregateBars — 1m → 5m", () => {
  it("aggregates 5 contiguous bars (boundary-aligned) into 1 output", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 300); // 5m boundary
    expect(start % 300).toBe(0);

    const bars = make1m(5, start);
    const out = aggregateBars(bars, 5);

    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(start);
    expect(out[0].open).toBe(bars[0].open);
    expect(out[0].close).toBe(bars[4].close);
    expect(out[0].high).toBe(Math.max(...bars.map((b) => b.high)));
    expect(out[0].low).toBe(Math.min(...bars.map((b) => b.low)));
    expect(out[0].volume).toBe(bars.reduce((s, b) => s + b.volume, 0));
  });

  it("emits two output bars when input straddles a bucket boundary", () => {
    // Start NOT aligned: 1_700_000_000 % 300 == 200, so first bar is 200s into a bucket
    // and only minutes [0..1] (60..120s into bucket) fall before the next 5m boundary.
    const start = 1_700_000_000;
    expect(start % 300).toBe(200);
    const bars = make1m(5, start);
    const out = aggregateBars(bars, 5);
    // Bars 0,1 in first bucket (1_699_999_800); bars 2,3,4 in second bucket (1_700_000_100).
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(1_699_999_800);
    expect(out[1].time).toBe(1_700_000_100);
  });

  it("aggregates 15 contiguous bars across exact bucket boundaries", () => {
    const start = 1_700_000_100; // already a 5m boundary (divisible by 300)
    expect(start % 300).toBe(0);

    const bars = make1m(15, start);
    const out = aggregateBars(bars, 5);

    expect(out).toHaveLength(3);
    // First 5m bar covers minutes 0..4
    expect(out[0].time).toBe(start);
    expect(out[0].open).toBe(bars[0].open);
    expect(out[0].close).toBe(bars[4].close);
    expect(out[0].high).toBe(Math.max(...bars.slice(0, 5).map((b) => b.high)));
    expect(out[0].low).toBe(Math.min(...bars.slice(0, 5).map((b) => b.low)));
    expect(out[0].volume).toBe(bars.slice(0, 5).reduce((s, b) => s + b.volume, 0));

    // Second 5m bar covers minutes 5..9
    expect(out[1].time).toBe(start + 300);
    expect(out[1].open).toBe(bars[5].open);
    expect(out[1].close).toBe(bars[9].close);

    // Third 5m bar covers minutes 10..14
    expect(out[2].time).toBe(start + 600);
    expect(out[2].close).toBe(bars[14].close);
  });
});

describe("aggregateBars — 1m → 15m and 1m → 1h", () => {
  it("aggregates 15 contiguous bars into one 15m bar (boundary-aligned)", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 900); // align to 15m
    const bars = make1m(15, start);
    const out = aggregateBars(bars, 15);
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(start);
    expect(out[0].open).toBe(bars[0].open);
    expect(out[0].close).toBe(bars[14].close);
    expect(out[0].volume).toBe(bars.reduce((s, b) => s + b.volume, 0));
  });

  it("aggregates 60 contiguous bars into one 1h bar (boundary-aligned)", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 3600); // align to 1h
    const bars = make1m(60, start);
    const out = aggregateBars(bars, 60);
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(start);
    expect(out[0].open).toBe(bars[0].open);
    expect(out[0].close).toBe(bars[59].close);
    expect(out[0].high).toBe(Math.max(...bars.map((b) => b.high)));
    expect(out[0].low).toBe(Math.min(...bars.map((b) => b.low)));
    expect(out[0].volume).toBe(bars.reduce((s, b) => s + b.volume, 0));
  });

  it("aggregates 120 contiguous bars into 8 fifteen-minute bars", () => {
    const start = 1_700_000_000 - (1_700_000_000 % 900);
    const bars = make1m(120, start);
    const out = aggregateBars(bars, 15);
    expect(out).toHaveLength(8);
    // First and last sanity
    expect(out[0].time).toBe(start);
    expect(out[7].time).toBe(start + 7 * 900);
    expect(out[7].close).toBe(bars[119].close);
  });
});

describe("aggregateBars — session gaps preserved (Fri close → Sun open)", () => {
  it("does NOT collapse a Friday-22:00 to Sunday-22:00 gap into a single 5m bar", () => {
    // 5 Friday bars ending at 21:59 UTC (the last Friday minutes before forex close).
    // 2026-04-24 was a Friday. Pick 21:55 → 21:59.
    const friStart = Math.floor(new Date("2026-04-24T21:55:00Z").getTime() / 1000);
    const fridayBars: Bar[] = Array.from({ length: 5 }, (_, i) => ({
      time: friStart + i * 60,
      open: 1.10 + i * 0.0001,
      high: 1.105 + i * 0.0001,
      low: 1.099 + i * 0.0001,
      close: 1.102 + i * 0.0001,
      volume: 100,
    }));

    // Sunday 22:00 → 22:04 UTC, 2026-04-26.
    const sunStart = Math.floor(new Date("2026-04-26T22:00:00Z").getTime() / 1000);
    const sundayBars: Bar[] = Array.from({ length: 5 }, (_, i) => ({
      time: sunStart + i * 60,
      open: 1.103 + i * 0.0001,
      high: 1.108 + i * 0.0001,
      low: 1.102 + i * 0.0001,
      close: 1.106 + i * 0.0001,
      volume: 100,
    }));

    // Hour-and-five-minutes apart? No — about 48h apart.
    expect(sunStart - friStart).toBeGreaterThan(48 * 3600);

    const input = [...fridayBars, ...sundayBars];
    const out = aggregateBars(input, 5);

    // Friday bars all fall in one 5m bucket (21:55 = boundary). Same for Sunday.
    expect(out).toHaveLength(2);

    // Time gap on output >> 5 minutes
    expect(out[1].time - out[0].time).toBeGreaterThan(48 * 3600);

    // The Friday output should reflect ONLY Friday data
    expect(out[0].open).toBe(fridayBars[0].open);
    expect(out[0].close).toBe(fridayBars[4].close);
    expect(out[0].volume).toBe(500); // 5 × 100

    // The Sunday output should reflect ONLY Sunday data — NOT a merged FRI+SUN bar
    expect(out[1].open).toBe(sundayBars[0].open);
    expect(out[1].close).toBe(sundayBars[4].close);
    expect(out[1].volume).toBe(500);
  });

  it("preserves a session gap when aggregating to 1h", () => {
    const friStart = Math.floor(new Date("2026-04-24T21:00:00Z").getTime() / 1000);
    const friday: Bar[] = Array.from({ length: 60 }, (_, i) => ({
      time: friStart + i * 60,
      open: 1.10,
      high: 1.105,
      low: 1.095,
      close: 1.10,
      volume: 1,
    }));
    const sunStart = Math.floor(new Date("2026-04-26T22:00:00Z").getTime() / 1000);
    const sunday: Bar[] = Array.from({ length: 60 }, (_, i) => ({
      time: sunStart + i * 60,
      open: 1.10,
      high: 1.105,
      low: 1.095,
      close: 1.10,
      volume: 1,
    }));

    const out = aggregateBars([...friday, ...sunday], 60);
    expect(out).toHaveLength(2);
    expect(out[1].time - out[0].time).toBeGreaterThan(40 * 3600);
  });
});
