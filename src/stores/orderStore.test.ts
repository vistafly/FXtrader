import { beforeEach, describe, expect, it } from "vitest";

import { processBar } from "@/lib/engine/MatchingEngine";
import { ReplayEngine } from "@/lib/engine/ReplayEngine";
import { EURUSD } from "@/lib/instruments/instruments";
import { useReplayStore } from "@/stores/replayStore";
import type { Bar } from "@/types/bar";

import { useOrderStore } from "./orderStore";

const SESSION = "sess-test";

const makeBar = (o: Partial<Bar> = {}): Bar => ({
  time: 1_700_000_000,
  open: 1.1,
  high: 1.105,
  low: 1.095,
  close: 1.102,
  volume: 1000,
  ...o,
});

/**
 * Seed a real ReplayEngine into the replay store so submitOrder("market") can
 * read the current bar (now required since market orders fill immediately
 * against the current bar's close — see orderStore.submitOrder).
 */
function seedEngineWithBar(bar: Bar) {
  const engine = new ReplayEngine();
  engine.load([bar], 0);
  // v2.2.5α: register the engine in the multi-instrument Map under the
  // EURUSD symbol so getEngine("EURUSD") finds it. Active instrument is
  // EURUSD so legacy `engine` reads also resolve.
  const engines = new Map<string, ReplayEngine>();
  engines.set(EURUSD.symbol, engine);
  useReplayStore.setState({
    engines,
    activeInstrument: EURUSD.symbol,
    engine,
    currentBarTime: bar.time,
    currentBarIndex: 0,
    totalBars: 1,
    isPlaying: false,
    speed: 1,
  });
}

const submitMarketBuy = async (size = 1, sl?: number, tp?: number) =>
  useOrderStore.getState().submitOrder({
    sessionId: SESSION,
    instrument: EURUSD.symbol,
    side: "buy",
    type: "market",
    size,
    stopLoss: sl,
    takeProfit: tp,
  });

describe("orderStore.applyBarResult — engine seam", () => {
  beforeEach(() => {
    useOrderStore.getState().resetForSession();
    useReplayStore.setState({
      engines: new Map(),
      activeInstrument: null,
      engine: null,
      currentBarTime: 0,
      currentBarIndex: 0,
      totalBars: 0,
      isPlaying: false,
      speed: 1,
    });
  });

  it("market buy fills IMMEDIATELY at current bar's close, no engine roundtrip", async () => {
    seedEngineWithBar(makeBar({ close: 1.102 }));

    await submitMarketBuy(1, 1.095, 1.105);

    const state = useOrderStore.getState();
    // Market orders skip pendingOrders entirely (UX deviation from spec §6).
    expect(state.pendingOrders).toHaveLength(0);
    expect(state.openPositions).toHaveLength(1);
    expect(state.openPositions[0].entryPrice).toBe(1.102);
    expect(state.openPositions[0].size).toBe(1);
    expect(state.openPositions[0].takeProfit).toBe(1.105);
    expect(state.openPositions[0].stopLoss).toBe(1.095);
  });

  it("TP closure on the next bar moves position → closedTrades with realized P&L", async () => {
    // Entry bar — fills immediately at close = 1.10.
    seedEngineWithBar(makeBar({ close: 1.10 }));
    await submitMarketBuy(1, 1.095, 1.105);
    expect(useOrderStore.getState().openPositions).toHaveLength(1);

    // Next bar pushes high above TP=1.105 → position closes at TP.
    const bar2 = makeBar({
      time: 1_700_000_060,
      open: 1.103,
      high: 1.107,
      low: 1.101,
      close: 1.106,
    });
    const result = processBar({
      bar: bar2,
      pendingOrders: useOrderStore.getState().pendingOrders,
      openPositions: useOrderStore.getState().openPositions,
      instrument: EURUSD,
    });
    const { closuresApplied } = useOrderStore.getState().applyBarResult(
      result,
      bar2,
      EURUSD,
    );

    const state = useOrderStore.getState();
    expect(state.openPositions).toHaveLength(0);
    expect(state.closedTrades).toHaveLength(1);
    // gross = (1.105 - 1.10) * 100,000 = $500. commission = 3.5*1*2 = $7.
    expect(state.closedTrades[0].pnl).toBeCloseTo(493, 6);
    expect(state.closedTrades[0].closeReason).toBe("tp");
    expect(closuresApplied).toHaveLength(1);
    expect(closuresApplied[0].realizedPnl).toBeCloseTo(493, 6);
  });

  it("closePosition closes IMMEDIATELY at current bar's close (UX deviation)", async () => {
    // Open a position at entry 1.10.
    seedEngineWithBar(makeBar({ close: 1.10 }));
    await submitMarketBuy(1);
    expect(useOrderStore.getState().openPositions).toHaveLength(1);

    // Move the engine to a new bar where price has risen.
    seedEngineWithBar(
      makeBar({
        time: 1_700_000_060,
        open: 1.108,
        high: 1.110,
        low: 1.107,
        close: 1.109,
      }),
    );

    const posId = useOrderStore.getState().openPositions[0].id;
    await useOrderStore.getState().closePosition(posId);

    // Position should be gone immediately — no need to wait for a bar event.
    const state = useOrderStore.getState();
    expect(state.openPositions).toHaveLength(0);
    expect(state.closedTrades).toHaveLength(1);
    expect(state.closedTrades[0].closeReason).toBe("manual");
    // Closes at current bar's close (1.109), not next bar's open.
    expect(state.closedTrades[0].exitPrice).toBe(1.109);
    // (1.109 - 1.10) * 100,000 - $7 commission = $893
    expect(state.closedTrades[0].pnl).toBeCloseTo(893, 6);
  });

  it("rejected orders are dropped from pendingOrders", async () => {
    // Seed an engine first so submitOrder picks up the simulated time
    // (otherwise createdAt = Date.now() and the temporal guard would skip
    // this order against the historical test bar).
    seedEngineWithBar(makeBar());
    // Submit an invalid limit order (no limitPrice). Limit orders DO go through pendingOrders.
    await useOrderStore.getState().submitOrder({
      sessionId: SESSION,
      instrument: EURUSD.symbol,
      side: "buy",
      type: "limit",
      size: 1,
    });
    expect(useOrderStore.getState().pendingOrders).toHaveLength(1);

    const bar = makeBar();
    const result = processBar({
      bar,
      pendingOrders: useOrderStore.getState().pendingOrders,
      openPositions: useOrderStore.getState().openPositions,
      instrument: EURUSD,
    });
    useOrderStore.getState().applyBarResult(result, bar, EURUSD);

    expect(useOrderStore.getState().pendingOrders).toHaveLength(0);
    expect(useOrderStore.getState().openPositions).toHaveLength(0);
  });

  it("cancelOrder removes a pending limit order before it can fill", async () => {
    const order = await useOrderStore.getState().submitOrder({
      sessionId: SESSION,
      instrument: EURUSD.symbol,
      side: "buy",
      type: "limit",
      size: 1,
      limitPrice: 1.05, // far from market — won't fill on this bar
    });
    expect(useOrderStore.getState().pendingOrders).toHaveLength(1);
    await useOrderStore.getState().cancelOrder(order.id);
    expect(useOrderStore.getState().pendingOrders).toHaveLength(0);
  });

  it("modifyPosition updates TP/SL on an open position", async () => {
    seedEngineWithBar(makeBar({ close: 1.10 }));
    await submitMarketBuy(1);

    const posId = useOrderStore.getState().openPositions[0].id;
    await useOrderStore.getState().modifyPosition(posId, {
      tp: 1.12,
      sl: 1.09,
    });

    const p = useOrderStore.getState().openPositions[0];
    expect(p.takeProfit).toBe(1.12);
    expect(p.stopLoss).toBe(1.09);
  });

  it("modifyPosition with explicit undefined CLEARS the TP/SL value", async () => {
    seedEngineWithBar(makeBar({ close: 1.10 }));
    await submitMarketBuy(1, 1.095, 1.105);

    const posId = useOrderStore.getState().openPositions[0].id;
    expect(useOrderStore.getState().openPositions[0].takeProfit).toBe(1.105);

    await useOrderStore.getState().modifyPosition(posId, { tp: undefined });
    expect(useOrderStore.getState().openPositions[0].takeProfit).toBeUndefined();
    expect(useOrderStore.getState().openPositions[0].stopLoss).toBe(1.095);

    await useOrderStore.getState().modifyPosition(posId, { sl: undefined });
    expect(useOrderStore.getState().openPositions[0].stopLoss).toBeUndefined();
  });

  it("temporal guard: bars BEFORE position.entryTime do not retroactively trigger TP/SL", async () => {
    // Open a position at bar @ time 1_700_000_500 with a TP at 1.105.
    seedEngineWithBar(makeBar({ time: 1_700_000_500, close: 1.10 }));
    await submitMarketBuy(1, 1.095, 1.105);
    expect(useOrderStore.getState().openPositions).toHaveLength(1);

    // Now process an EARLIER bar whose high crosses the TP. Without the
    // guard this would close the position retroactively (which is what
    // happens when the user scrubs back through history).
    const earlierBar = makeBar({
      time: 1_700_000_000, // earlier than entryTime
      open: 1.10,
      high: 1.110, // above TP — would normally trigger
      low: 1.095,
      close: 1.106,
    });
    const result = processBar({
      bar: earlierBar,
      pendingOrders: useOrderStore.getState().pendingOrders,
      openPositions: useOrderStore.getState().openPositions,
      instrument: EURUSD,
    });
    useOrderStore.getState().applyBarResult(result, earlierBar, EURUSD);

    // Position must still be open — temporal guard skipped the closure.
    expect(useOrderStore.getState().openPositions).toHaveLength(1);
    expect(useOrderStore.getState().closedTrades).toHaveLength(0);
  });

  it("modifyOrder updates a pending limit order's trigger price", async () => {
    const order = await useOrderStore.getState().submitOrder({
      sessionId: SESSION,
      instrument: EURUSD.symbol,
      side: "buy",
      type: "limit",
      size: 1,
      limitPrice: 1.05,
    });
    expect(useOrderStore.getState().pendingOrders[0].limitPrice).toBe(1.05);

    await useOrderStore.getState().modifyOrder(order.id, { limitPrice: 1.07 });
    expect(useOrderStore.getState().pendingOrders[0].limitPrice).toBe(1.07);
  });
});
