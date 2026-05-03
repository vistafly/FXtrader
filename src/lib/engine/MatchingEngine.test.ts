import { describe, expect, it } from "vitest";

import { EURUSD, NQ1 } from "@/lib/instruments/instruments";
import type { Bar } from "@/types/bar";
import type { Order } from "@/types/order";
import type { Position } from "@/types/position";

import {
  computeCommission,
  computePnl,
  processBar,
} from "./MatchingEngine";

// ---- Fixtures --------------------------------------------------------------

const SESSION_ID = "sess-1";

const makeBar = (overrides: Partial<Bar> = {}): Bar => ({
  time: 1_700_000_000,
  open: 1.1,
  high: 1.105,
  low: 1.095,
  close: 1.102,
  volume: 1000,
  ...overrides,
});

const makeOrder = (overrides: Partial<Order>): Order => ({
  id: "ord-1",
  sessionId: SESSION_ID,
  instrument: EURUSD.symbol,
  side: "buy",
  type: "market",
  size: 1,
  status: "pending",
  createdAt: 1_699_999_900,
  ...overrides,
});

const makePosition = (overrides: Partial<Position>): Position => ({
  id: "pos-1",
  sessionId: SESSION_ID,
  instrument: EURUSD.symbol,
  side: "buy",
  size: 1,
  entryPrice: 1.1,
  entryTime: 1_699_999_900,
  unrealizedPnl: 0,
  realizedPnl: 0,
  commission: 0,
  status: "open",
  ...overrides,
});

// Deterministic id generator for tests.
const seqIds = () => {
  let n = 0;
  return () => `id-${++n}`;
};

// ---- Tests -----------------------------------------------------------------

describe("processBar — order fills (spec §6)", () => {
  it("fills a market order at next-bar open", () => {
    const bar = makeBar({ open: 1.2 });
    const order = makeOrder({ type: "market", side: "buy" });

    const result = processBar({
      bar,
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(result.fills).toHaveLength(1);
    expect(result.fills[0].filledPrice).toBe(1.2);
    expect(result.fills[0].position.entryPrice).toBe(1.2);
    expect(result.fills[0].position.side).toBe("buy");
    expect(result.fills[0].position.status).toBe("open");
  });

  it("waits on a buy limit below current price, fills when price drops", () => {
    const order = makeOrder({ type: "limit", side: "buy", limitPrice: 1.09 });

    // Bar 1 — price doesn't reach the limit.
    const r1 = processBar({
      bar: makeBar({ open: 1.10, high: 1.105, low: 1.095, close: 1.102 }),
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r1.fills).toHaveLength(0);

    // Bar 2 — price drops to the limit.
    const r2 = processBar({
      bar: makeBar({ time: 1_700_000_060, open: 1.095, high: 1.097, low: 1.085, close: 1.090 }),
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r2.fills).toHaveLength(1);
    // limit buy fill price: min(limitPrice, bar.open) = min(1.09, 1.095) = 1.09
    expect(r2.fills[0].filledPrice).toBeCloseTo(1.09, 6);
  });

  it("limit buy with gap below limit fills at bar.open (favorable slippage)", () => {
    // Bar opens BELOW the limit — fill at the better price (open, not limit).
    const order = makeOrder({ type: "limit", side: "buy", limitPrice: 1.09 });
    const bar = makeBar({ open: 1.085, high: 1.092, low: 1.080, close: 1.088 });

    const r = processBar({
      bar,
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].filledPrice).toBe(1.085); // min(1.09, 1.085)
  });

  it("fills a limit sell when high crosses limit", () => {
    const order = makeOrder({ type: "limit", side: "sell", limitPrice: 1.110 });
    const bar = makeBar({ open: 1.100, high: 1.115, low: 1.098, close: 1.112 });

    const r = processBar({
      bar,
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r.fills).toHaveLength(1);
    // limit sell: max(limitPrice, bar.open) = max(1.110, 1.100) = 1.110
    expect(r.fills[0].filledPrice).toBe(1.110);
  });

  it("fills a stop buy at stop price (or worse on gap)", () => {
    const order = makeOrder({ type: "stop", side: "buy", stopPrice: 1.105 });
    // Bar gaps OPEN above the stop — fill at worse price (open, not stop).
    const bar = makeBar({ open: 1.108, high: 1.115, low: 1.106, close: 1.112 });

    const r = processBar({
      bar,
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].filledPrice).toBe(1.108); // max(1.105, 1.108)
  });

  it("fills a stop sell at stop price (or worse on gap)", () => {
    const order = makeOrder({ type: "stop", side: "sell", stopPrice: 1.095 });
    // Bar gaps OPEN below the stop — fill at worse price (open).
    const bar = makeBar({ open: 1.092, high: 1.094, low: 1.085, close: 1.088 });

    const r = processBar({
      bar,
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].filledPrice).toBe(1.092); // min(1.095, 1.092)
  });

  it("rejects a limit order missing limitPrice", () => {
    const order = makeOrder({ type: "limit", side: "buy" });
    const r = processBar({
      bar: makeBar(),
      pendingOrders: [order],
      openPositions: [],
      instrument: EURUSD,
      idGen: seqIds(),
    });
    expect(r.rejections).toHaveLength(1);
    expect(r.rejections[0].orderId).toBe("ord-1");
  });
});

describe("processBar — position TP/SL (spec §6)", () => {
  it("closes a long position at TP when high >= TP, with realizedPnl > 0", () => {
    const pos = makePosition({
      side: "buy",
      entryPrice: 1.10,
      takeProfit: 1.105,
      size: 1,
    });
    const bar = makeBar({ open: 1.101, high: 1.106, low: 1.100, close: 1.104 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    const closure = r.closures[0];
    expect(closure.reason).toBe("tp");
    expect(closure.closePrice).toBe(1.105);
    // gross = 0.005 * 100,000 * 1 = $500. Commission = 3.5 * 1 * 2 = $7. Realized = $493.
    expect(closure.realizedPnl).toBeCloseTo(493, 6);
    expect(closure.realizedPnl).toBeGreaterThan(0);
    expect(closure.commission).toBeCloseTo(7, 6);
  });

  it("closes a long position at SL when low <= SL", () => {
    const pos = makePosition({
      side: "buy",
      entryPrice: 1.10,
      stopLoss: 1.095,
    });
    const bar = makeBar({ open: 1.099, high: 1.101, low: 1.094, close: 1.098 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].reason).toBe("sl");
    expect(r.closures[0].closePrice).toBe(1.095);
    expect(r.closures[0].realizedPnl).toBeLessThan(0);
  });

  it("SL wins when TP and SL both hit in the same bar (long)", () => {
    const pos = makePosition({
      side: "buy",
      entryPrice: 1.10,
      takeProfit: 1.105,
      stopLoss: 1.095,
    });
    // Bar range crosses both.
    const bar = makeBar({ open: 1.10, high: 1.106, low: 1.094, close: 1.100 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].reason).toBe("sl");
    expect(r.closures[0].closePrice).toBe(1.095);
  });

  it("SL wins when TP and SL both hit in the same bar (short)", () => {
    const pos = makePosition({
      side: "sell",
      entryPrice: 1.10,
      takeProfit: 1.095, // for a short, TP is below entry
      stopLoss: 1.105,   // SL above entry
    });
    // Bar range crosses both: high >= 1.105 AND low <= 1.095.
    const bar = makeBar({ open: 1.10, high: 1.107, low: 1.094, close: 1.100 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].reason).toBe("sl");
    expect(r.closures[0].closePrice).toBe(1.105);
  });

  it("closes a short position at TP when low <= TP", () => {
    const pos = makePosition({
      side: "sell",
      entryPrice: 1.10,
      takeProfit: 1.095,
    });
    const bar = makeBar({ open: 1.099, high: 1.100, low: 1.094, close: 1.096 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].reason).toBe("tp");
    expect(r.closures[0].closePrice).toBe(1.095);
    // gross = (1.10 - 1.095) * 100,000 * 1 = $500.
    expect(r.closures[0].realizedPnl).toBeCloseTo(500 - 7, 6);
  });
});

describe("processBar — commission & P&L", () => {
  it("deducts commission exactly once on close (round-turn)", () => {
    const pos = makePosition({
      side: "buy",
      entryPrice: 1.10,
      takeProfit: 1.105,
      size: 2,
    });
    const bar = makeBar({ open: 1.101, high: 1.106, low: 1.100, close: 1.105 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    // EURUSD.commission = 3.5 per side per lot, 2 lots → 3.5 * 2 * 2 = $14.
    expect(r.closures[0].commission).toBeCloseTo(14, 6);
    expect(computeCommission(EURUSD, 2)).toBeCloseTo(14, 6);
  });

  it("computes correct P&L for a sell-short followed by buy-back", () => {
    // Short at 1.10, cover at 1.09 → +0.01 * 100,000 = $1,000 gross. Commission $7. Net $993.
    const pos = makePosition({
      side: "sell",
      entryPrice: 1.10,
      takeProfit: 1.09,
    });
    const bar = makeBar({ open: 1.099, high: 1.100, low: 1.085, close: 1.088 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].closePrice).toBe(1.09);
    expect(r.closures[0].realizedPnl).toBeCloseTo(1000 - 7, 6);
  });

  it("futures P&L uses tickValue / tickSize (NQ: $20/point)", () => {
    // Long NQ at 15000, exit 15010 → +10 points * $20 * 1 contract = $200. Commission $5.
    const grossPnl = computePnl(NQ1, "buy", 15000, 15010, 1);
    expect(grossPnl).toBeCloseTo(200, 6);
    expect(computeCommission(NQ1, 1)).toBeCloseTo(5, 6);
  });
});

describe("processBar — liquidation (spec §6)", () => {
  it("liquidates all open positions when balance + unrealized < 0", () => {
    // Big short position vs adverse bar drives unrealized way negative.
    const pos = makePosition({
      side: "buy",
      entryPrice: 1.10,
      size: 5, // 5 lots
    });
    // bar.close = 1.08 → unrealized = -0.02 * 100,000 * 5 = -$10,000.
    const bar = makeBar({ open: 1.099, high: 1.100, low: 1.075, close: 1.080 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      equityCheck: { balance: 1000 }, // 1k balance < 10k loss → liquidate
      idGen: seqIds(),
    });

    expect(r.liquidated).toBe(true);
    expect(r.closures).toHaveLength(1);
    expect(r.closures[0].reason).toBe("liquidated");
    expect(r.closures[0].closePrice).toBe(1.080); // closed at bar.close
  });

  it("does not liquidate when balance + unrealized stays >= 0", () => {
    const pos = makePosition({ side: "buy", entryPrice: 1.10, size: 1 });
    const bar = makeBar({ open: 1.099, high: 1.100, low: 1.095, close: 1.098 });

    const r = processBar({
      bar,
      pendingOrders: [],
      openPositions: [pos],
      instrument: EURUSD,
      equityCheck: { balance: 1000 },
      idGen: seqIds(),
    });

    expect(r.liquidated).toBe(false);
    expect(r.closures).toHaveLength(0);
  });
});

describe("processBar — purity", () => {
  it("does not mutate input arrays", () => {
    const order = makeOrder({ type: "market" });
    const pos = makePosition({ takeProfit: 1.105 });
    const orders = [order];
    const positions = [pos];
    const ordersSnapshot = JSON.stringify(orders);
    const positionsSnapshot = JSON.stringify(positions);

    processBar({
      bar: makeBar(),
      pendingOrders: orders,
      openPositions: positions,
      instrument: EURUSD,
      idGen: seqIds(),
    });

    expect(JSON.stringify(orders)).toBe(ordersSnapshot);
    expect(JSON.stringify(positions)).toBe(positionsSnapshot);
  });
});
