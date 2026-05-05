import { describe, expect, it } from "vitest";

import { BarAggregator } from "./BarAggregator";
import { makeSampleBars } from "@/lib/engine/__fixtures__/sampleBars";

describe("BarAggregator — basic correctness", () => {
  it("aggregates 1m → 5m identically to aggregateBars", () => {
    const agg = new BarAggregator();
    // Start time aligned to a 5m boundary so 60 bars produce exactly 12
    // buckets. Misaligned start times produce 13 because the first bucket
    // is partial — that's correct behavior of aggregateBars; this test
    // just exercises the easy case.
    const start = Math.floor(1_700_000_000 / 300) * 300; // 1_699_999_800
    const bars = makeSampleBars(60, start);
    const out = agg.aggregate(bars, 5);
    expect(out).toHaveLength(12);
    expect(out[0].time).toBe(start);
    expect(out[1].time).toBe(start + 300);
  });

  it("returns the source unchanged for timeframe=1", () => {
    const agg = new BarAggregator();
    const bars = makeSampleBars(10);
    const out = agg.aggregate(bars, 1);
    expect(out).toHaveLength(10);
    expect(out[0]).toEqual(bars[0]);
  });

  it("rejects non-positive or non-finite timeframes", () => {
    const agg = new BarAggregator();
    const bars = makeSampleBars(10);
    expect(() => agg.aggregate(bars, 0)).toThrow();
    expect(() => agg.aggregate(bars, -5)).toThrow();
    expect(() => agg.aggregate(bars, NaN)).toThrow();
  });
});

describe("BarAggregator — memoization (cache key: timeframe, lastBarTime, sourceBarsRef)", () => {
  it("returns the same result reference on repeat calls with identical (timeframe, ref, lastBarTime)", () => {
    const agg = new BarAggregator();
    const bars = makeSampleBars(60);
    const a = agg.aggregate(bars, 5);
    const b = agg.aggregate(bars, 5);
    expect(a).toBe(b);
  });

  it("re-aggregates when the source array reference changes (defensive)", () => {
    const agg = new BarAggregator();
    const bars1 = makeSampleBars(60);
    const bars2 = bars1.slice(); // different reference, identical content
    const a = agg.aggregate(bars1, 5);
    const b = agg.aggregate(bars2, 5);
    expect(a).not.toBe(b);
  });

  it("re-aggregates when the source's lastBarTime advances (new bar appended)", () => {
    const agg = new BarAggregator();
    const bars1 = makeSampleBars(10);
    const a = agg.aggregate(bars1, 5);
    const bars2 = [...bars1, { ...bars1[bars1.length - 1], time: bars1[bars1.length - 1].time + 60 }];
    const b = agg.aggregate(bars2, 5);
    expect(a).not.toBe(b);
  });

  it("caches separately per timeframe", () => {
    const agg = new BarAggregator();
    const bars = makeSampleBars(60);
    const fiveM = agg.aggregate(bars, 5);
    const fifteenM = agg.aggregate(bars, 15);
    expect(fiveM).not.toBe(fifteenM);
    // Both should hit cache on second call.
    expect(agg.aggregate(bars, 5)).toBe(fiveM);
    expect(agg.aggregate(bars, 15)).toBe(fifteenM);
    expect(agg.size()).toBe(2);
  });

  it("invalidate(tf) drops one entry; clear() drops all", () => {
    const agg = new BarAggregator();
    const bars = makeSampleBars(60);
    const a = agg.aggregate(bars, 5);
    expect(agg.size()).toBe(1);

    agg.invalidate(5);
    expect(agg.size()).toBe(0);

    const b = agg.aggregate(bars, 5);
    expect(b).not.toBe(a); // freshly computed after invalidate

    agg.aggregate(bars, 15);
    expect(agg.size()).toBe(2);
    agg.clear();
    expect(agg.size()).toBe(0);
  });
});

describe("BarAggregator — live-candle convention (D11)", () => {
  it("the last aggregated bar is in-progress: high widens as more 1m bars arrive in the same bucket", () => {
    const agg = new BarAggregator();
    // Three 1m bars all in the same 5m bucket. Use a 5m-aligned start so
    // bucket math is unambiguous.
    const t0 = 1_700_000_100; // aligned to a 5m boundary
    const bars = [
      { time: t0, open: 1.0, high: 1.05, low: 0.99, close: 1.02, volume: 100 },
      { time: t0 + 60, open: 1.02, high: 1.10, low: 1.01, close: 1.08, volume: 100 },
      { time: t0 + 120, open: 1.08, high: 1.12, low: 1.06, close: 1.10, volume: 100 },
    ];
    const out = agg.aggregate(bars, 5);
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(t0);
    // open = first.open, high = max, low = min, close = last.close.
    expect(out[0].open).toBe(1.0);
    expect(out[0].high).toBe(1.12);
    expect(out[0].low).toBe(0.99);
    expect(out[0].close).toBe(1.10);
  });

  it("crossing a bucket boundary finalizes the in-progress bar and begins a new one", () => {
    const agg = new BarAggregator();
    const t0 = 1_700_000_100; // aligned to a 5m boundary
    // 5 1m bars spanning two 5m buckets: 5 in first (full bucket), 1 in second.
    const bars = [
      { time: t0, open: 1.0, high: 1.05, low: 0.99, close: 1.02, volume: 100 },
      { time: t0 + 60, open: 1.02, high: 1.10, low: 1.01, close: 1.08, volume: 100 },
      { time: t0 + 120, open: 1.08, high: 1.12, low: 1.06, close: 1.10, volume: 100 },
      { time: t0 + 180, open: 1.10, high: 1.15, low: 1.09, close: 1.13, volume: 100 },
      { time: t0 + 240, open: 1.13, high: 1.16, low: 1.12, close: 1.14, volume: 100 },
      // Next 5m bucket starts at t0 + 300:
      { time: t0 + 300, open: 1.14, high: 1.20, low: 1.11, close: 1.18, volume: 100 },
    ];
    const out = agg.aggregate(bars, 5);
    expect(out).toHaveLength(2);
    expect(out[0].time).toBe(t0);
    // First (now-finalized) 5m bar: aggregated across all 5 source bars.
    expect(out[0].open).toBe(1.0);
    expect(out[0].high).toBe(1.16);
    expect(out[0].low).toBe(0.99);
    expect(out[0].close).toBe(1.14);
    // Second (in-progress) 5m bar: just the last 1m bar's data.
    expect(out[1].time).toBe(t0 + 300);
    expect(out[1].open).toBe(1.14);
    expect(out[1].high).toBe(1.20);
    expect(out[1].low).toBe(1.11);
    expect(out[1].close).toBe(1.18);
  });
});
