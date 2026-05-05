import { describe, expect, it } from "vitest";

import type {
  AttemptEvent,
  StartEvent,
  SubmitOrderEvent,
} from "./AttemptEvent";
import {
  applyEvent,
  initialReducerState,
  ReducerInvalidEventError,
  ReducerSeqGapError,
  replayEvents,
} from "./AttemptReducer";

const startEvent = (overrides: Partial<StartEvent> = {}): StartEvent => ({
  seq: 0,
  time: 1_700_000_000,
  type: "start",
  startingBalance: 10_000,
  battleId: "battle-1",
  instruments: ["EURUSD"],
  rules: {},
  ...overrides,
});

const submitOrder = (
  overrides: Partial<SubmitOrderEvent> = {},
): SubmitOrderEvent => ({
  seq: 1,
  time: 1_700_000_060,
  type: "submit-order",
  orderId: "ord-1",
  instrument: "EURUSD",
  side: "buy",
  orderType: "market",
  size: 1,
  ...overrides,
});

describe("AttemptReducer — start", () => {
  it("flips status to in-flight and snapshots starting balance", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(state.status).toBe("in-flight");
    expect(state.startingBalance).toBe(10_000);
    expect(state.balance).toBe(10_000);
    expect(state.battleId).toBe("battle-1");
    expect(state.instruments).toEqual(["EURUSD"]);
    expect(state.lastSeq).toBe(0);
  });

  it("rejects a non-start first event", () => {
    expect(() =>
      applyEvent(initialReducerState(), submitOrder({ seq: 0 })),
    ).toThrow(ReducerInvalidEventError);
  });

  it("rejects a duplicate start event", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, startEvent({ seq: 1 })),
    ).toThrow(ReducerInvalidEventError);
  });
});

describe("AttemptReducer — submit-order", () => {
  it("adds a pending limit order", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(
      state,
      submitOrder({
        orderType: "limit",
        limitPrice: 1.09,
        stopLoss: 1.085,
        takeProfit: 1.1,
      }),
    );
    expect(state.pendingOrders["ord-1"]).toEqual({
      id: "ord-1",
      instrument: "EURUSD",
      side: "buy",
      type: "limit",
      size: 1,
      limitPrice: 1.09,
      stopLoss: 1.085,
      takeProfit: 1.1,
    });
  });

  it("rejects duplicate orderId", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    expect(() =>
      applyEvent(state, submitOrder({ seq: 2, orderType: "limit", limitPrice: 1.10 })),
    ).toThrow(ReducerInvalidEventError);
  });
});

describe("AttemptReducer — cancel-order", () => {
  it("removes a pending order", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "cancel-order",
      orderId: "ord-1",
    });
    expect(state.pendingOrders).toEqual({});
  });

  it("rejects unknown orderId", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, {
        seq: 1,
        time: 1_700_000_060,
        type: "cancel-order",
        orderId: "ord-X",
      }),
    ).toThrow(ReducerInvalidEventError);
  });
});

describe("AttemptReducer — modify-order", () => {
  it("applies trigger price changes", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "modify-order",
      orderId: "ord-1",
      changes: { limitPrice: 1.092 },
    });
    expect(state.pendingOrders["ord-1"].limitPrice).toBe(1.092);
  });

  it("clears SL when changes contain explicit undefined", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(
      state,
      submitOrder({
        orderType: "limit",
        limitPrice: 1.09,
        stopLoss: 1.085,
      }),
    );
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "modify-order",
      orderId: "ord-1",
      changes: { stopLoss: undefined },
    });
    expect(state.pendingOrders["ord-1"].stopLoss).toBeUndefined();
  });

  it("rejects unknown orderId", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, {
        seq: 1,
        time: 1_700_000_060,
        type: "modify-order",
        orderId: "ord-X",
        changes: { limitPrice: 1.09 },
      }),
    ).toThrow(ReducerInvalidEventError);
  });
});

describe("AttemptReducer — order-fill + position-stop", () => {
  it("converts a pending order into an open position on order-fill", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "order-fill",
      orderId: "ord-1",
      positionId: "pos-1",
      fillPrice: 1.09,
      commission: 3.5,
    });
    expect(state.pendingOrders).toEqual({});
    expect(state.openPositions["pos-1"]).toMatchObject({
      id: "pos-1",
      orderId: "ord-1",
      entryPrice: 1.09,
      commission: 3.5,
    });
    // Entry commission charged.
    expect(state.balance).toBe(10_000 - 3.5);
  });

  it("realizes P&L and removes the position on position-stop", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "order-fill",
      orderId: "ord-1",
      positionId: "pos-1",
      fillPrice: 1.09,
      commission: 3.5,
    });
    state = applyEvent(state, {
      seq: 3,
      time: 1_700_000_180,
      type: "position-stop",
      positionId: "pos-1",
      reason: "tp",
      closePrice: 1.10,
      realizedPnl: 100,
      commission: 3.5,
    });
    expect(state.openPositions).toEqual({});
    expect(state.closedTrades).toHaveLength(1);
    expect(state.closedTrades[0]).toMatchObject({
      positionId: "pos-1",
      closeReason: "tp",
      realizedPnl: 100,
      commission: 7.0,
    });
    // Starting + realized − entry commission − close commission.
    expect(state.balance).toBe(10_000 + 100 - 3.5 - 3.5);
  });
});

describe("AttemptReducer — modify-position", () => {
  it("updates SL on an open position", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, submitOrder({ orderType: "limit", limitPrice: 1.09 }));
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "order-fill",
      orderId: "ord-1",
      positionId: "pos-1",
      fillPrice: 1.09,
      commission: 3.5,
    });
    state = applyEvent(state, {
      seq: 3,
      time: 1_700_000_180,
      type: "modify-position",
      positionId: "pos-1",
      changes: { stopLoss: 1.085 },
    });
    expect(state.openPositions["pos-1"].stopLoss).toBe(1.085);
  });
});

describe("AttemptReducer — liquidation + submit-final", () => {
  it("flips status to liquidated", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, {
      seq: 1,
      time: 1_700_000_060,
      type: "liquidation",
      ruleBreached: "maxDrawdown",
      finalBalance: 9_500,
      pnlPct: -5,
    });
    expect(state.status).toBe("liquidated");
    expect(state.liquidation?.ruleBreached).toBe("maxDrawdown");
  });

  it("submit-final is allowed from liquidated", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, {
      seq: 1,
      time: 1_700_000_060,
      type: "liquidation",
      ruleBreached: "maxDrawdown",
      finalBalance: 9_500,
      pnlPct: -5,
    });
    state = applyEvent(state, {
      seq: 2,
      time: 1_700_000_120,
      type: "submit-final",
      finalBalance: 9_500,
      pnlPct: -5,
      trades: 0,
      winRate: 0,
    });
    expect(state.status).toBe("completed");
    expect(state.finalizedAt).toBe(1_700_000_120);
  });

  it("rejects events after submit-final", () => {
    let state = applyEvent(initialReducerState(), startEvent());
    state = applyEvent(state, {
      seq: 1,
      time: 1_700_000_060,
      type: "submit-final",
      finalBalance: 10_000,
      pnlPct: 0,
      trades: 0,
      winRate: 0,
    });
    expect(() =>
      applyEvent(state, submitOrder({ seq: 2 })),
    ).toThrow(ReducerInvalidEventError);
  });
});

describe("AttemptReducer — seq gap (concern 3)", () => {
  it("throws ReducerSeqGapError when seq skips ahead", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, submitOrder({ seq: 2 })),
    ).toThrow(ReducerSeqGapError);
  });

  it("throws ReducerSeqGapError when seq is reused", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, submitOrder({ seq: 0 })),
    ).toThrow(ReducerSeqGapError);
  });

  it("throws ReducerSeqGapError when seq is non-monotonic", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    expect(() =>
      applyEvent(state, submitOrder({ seq: -1 })),
    ).toThrow(ReducerSeqGapError);
  });

  it("seq gap error carries expected/received metadata", () => {
    const state = applyEvent(initialReducerState(), startEvent());
    try {
      applyEvent(state, submitOrder({ seq: 3 }));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ReducerSeqGapError);
      const seqErr = err as ReducerSeqGapError;
      expect(seqErr.expected).toBe(1);
      expect(seqErr.received).toBe(3);
    }
  });
});

describe("replayEvents", () => {
  it("replays a full lifecycle to the same final state as step-by-step", () => {
    const events: AttemptEvent[] = [
      startEvent(),
      submitOrder({ orderType: "limit", limitPrice: 1.09 }),
      {
        seq: 2,
        time: 1_700_000_120,
        type: "order-fill",
        orderId: "ord-1",
        positionId: "pos-1",
        fillPrice: 1.09,
        commission: 3.5,
      },
      {
        seq: 3,
        time: 1_700_000_180,
        type: "position-stop",
        positionId: "pos-1",
        reason: "manual",
        closePrice: 1.095,
        realizedPnl: 50,
        commission: 3.5,
      },
      {
        seq: 4,
        time: 1_700_000_240,
        type: "submit-final",
        finalBalance: 10_043,
        pnlPct: 0.43,
        trades: 1,
        winRate: 100,
      },
    ];
    const stepByStep = events.reduce(
      (s, e) => applyEvent(s, e),
      initialReducerState(),
    );
    const replayed = replayEvents(events);
    expect(replayed).toEqual(stepByStep);
    expect(replayed.status).toBe("completed");
    expect(replayed.closedTrades).toHaveLength(1);
  });
});
