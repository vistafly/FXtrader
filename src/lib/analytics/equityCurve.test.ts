import { describe, expect, it } from "vitest";

import type { Trade } from "@/types/trade";

import { bucketTradePnls, buildEquityCurve } from "./equityCurve";

const t = (over: Partial<Trade>): Trade => ({
  id: over.id ?? "x",
  sessionId: "s1",
  instrument: "EURUSD",
  side: "buy",
  size: 1,
  entryPrice: 1.10,
  entryTime: 0,
  exitPrice: 1.10,
  exitTime: over.exitTime ?? 100,
  pnl: over.pnl ?? 0,
  pips: 0,
  commission: 0,
  duration: 60,
  closeReason: "manual",
  ...over,
});

describe("buildEquityCurve", () => {
  it("empty → empty array (caller renders no-trades UI)", () => {
    expect(buildEquityCurve([])).toEqual([]);
  });

  it("strictly increasing exitTime → one point per trade", () => {
    const curve = buildEquityCurve([
      t({ id: "1", exitTime: 100, pnl: 50 }),
      t({ id: "2", exitTime: 200, pnl: -20 }),
      t({ id: "3", exitTime: 300, pnl: 75 }),
    ]);
    expect(curve).toHaveLength(3);
    expect(curve.map((p) => p.cumulativePnl)).toEqual([50, 30, 105]);
    expect(curve.every((p) => p.tradesAtPoint === 1)).toBe(true);
  });

  it("same-exitTime trades aggregate into ONE jump (D2 spec)", () => {
    // Three trades all close at the same bar — should produce a single
    // equity-jump point combining their pnls.
    const curve = buildEquityCurve([
      t({ id: "a", exitTime: 100, pnl: 50 }),
      t({ id: "b", exitTime: 100, pnl: 30 }),
      t({ id: "c", exitTime: 100, pnl: -10 }),
    ]);
    expect(curve).toHaveLength(1);
    expect(curve[0].time).toBe(100);
    expect(curve[0].cumulativePnl).toBe(70);
    expect(curve[0].pnlAtPoint).toBe(70);
    expect(curve[0].tradesAtPoint).toBe(3);
  });

  it("mix of single + same-time trades", () => {
    const curve = buildEquityCurve([
      t({ id: "1", exitTime: 100, pnl: 50 }),
      t({ id: "2a", exitTime: 200, pnl: 30 }),
      t({ id: "2b", exitTime: 200, pnl: -20 }),
      t({ id: "3", exitTime: 300, pnl: 100 }),
    ]);
    expect(curve).toHaveLength(3);
    expect(curve[0]).toMatchObject({ time: 100, cumulativePnl: 50, tradesAtPoint: 1 });
    expect(curve[1]).toMatchObject({ time: 200, cumulativePnl: 60, tradesAtPoint: 2 });
    expect(curve[2]).toMatchObject({ time: 300, cumulativePnl: 160, tradesAtPoint: 1 });
  });
});

describe("bucketTradePnls", () => {
  it("empty → empty array", () => {
    expect(bucketTradePnls([])).toEqual([]);
  });

  it("single distinct pnl → 1-bucket synthetic histogram", () => {
    const out = bucketTradePnls([t({ pnl: 100 }), t({ pnl: 100 })]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
    expect(out[0].mid).toBe(100);
  });

  it("evenly distributes across N buckets", () => {
    const trades = Array.from({ length: 100 }, (_, i) =>
      t({ id: String(i), pnl: i }),
    );
    const out = bucketTradePnls(trades, 10);
    expect(out).toHaveLength(10);
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(100);
  });

  it("handles negative + positive range", () => {
    const out = bucketTradePnls([
      t({ pnl: -50 }),
      t({ pnl: 0 }),
      t({ pnl: 50 }),
    ], 5);
    expect(out).toHaveLength(5);
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(3);
    // Negative pnl in lowest bucket; positive in highest.
    expect(out[0].count).toBeGreaterThan(0);
    expect(out[out.length - 1].count).toBeGreaterThan(0);
  });
});
