/**
 * v2.3 sub-phase 2: live-mutation ≡ reducer equivalence property test.
 *
 * THE central test that justifies the event-log architecture. If the
 * reducer drifts from the orderStore's actual state mutations, resume
 * would silently produce wrong state — the bug class the user flagged
 * as the worst-debug-experience class.
 *
 * Approach:
 *   1. Set up real orderStore + sessionStore with a mocked
 *      replayStore engine (stub `getCurrentBar` returns a fixed bar).
 *   2. Generate a random sequence of user actions.
 *   3. Apply each action via the real orderStore mutation. The
 *      mutation enqueues events to AttemptEventQueue as a side effect.
 *   4. After the sequence completes, drain the queue's pending events.
 *   5. Apply those events to a fresh reducer.
 *   6. Project the orderStore's final state to ReducerState shape.
 *   7. Assert deep equality.
 *
 * What this exercises:
 *   - submit-order (market path → submit-order + order-fill events)
 *   - submit-order (limit/stop path → submit-order only, no fill)
 *   - cancel-order on a pending order
 *   - modify-order on a pending order
 *   - modify-position on an open position
 *   - close-position (manual close-now path → close-position +
 *     position-stop events)
 *
 * What this does NOT exercise (deferred to integration smoke):
 *   - applyBarResult engine settlement (TP/SL/liquidation closures
 *     produced by the engine on a bar tick)
 *   - forceCloseAllPositions (covered by liquidation flow integration)
 *   - bar-tick sampling
 *   - submit-final
 */

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeCommission } from "@/lib/engine/MatchingEngine";
import { getInstrument } from "@/lib/instruments/instruments";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";

import type { AttemptEvent } from "./AttemptEvent";
import { attemptEventQueue } from "./AttemptEventQueue";
import {
  replayEvents,
  type ReducerOpenPosition,
  type ReducerPendingOrder,
  type ReducerState,
} from "./AttemptReducer";

// ---- Test fixtures ------------------------------------------------------

const SESSION_ID = "test-session";
const ATTEMPT_ID = "test-attempt";
const STARTING_BALANCE = 100_000;

const FIXED_BAR_TIME = 1_700_000_000;
const FIXED_BAR = {
  time: FIXED_BAR_TIME,
  open: 1.09,
  high: 1.092,
  low: 1.088,
  close: 1.09,
  volume: 1_000_000,
};

/**
 * Mock engine. The orderStore calls .getCurrentBar() to derive market
 * fill prices. Fixed bar gives us deterministic fills.
 */
function makeMockEngine() {
  return {
    getCurrentBar: () => FIXED_BAR,
    // The other ReplayEngine surface area isn't touched by the orderStore
    // mutations under test, so leave them undefined — TS cast at the
    // setState boundary handles the type widening.
  };
}

function setupTestEnvironment(symbol: string = "EURUSD") {
  // Reset stores.
  useOrderStore.getState().resetForSession();
  useSessionStore.setState({
    activeSession: {
      id: SESSION_ID,
      name: "test",
      battleId: "test-battle",
      battleSource: "local",
      instrument: symbol,
      instruments: [symbol],
      startingBalance: STARTING_BALANCE,
      currentBalance: STARTING_BALANCE,
      startBarTime: FIXED_BAR_TIME,
      currentBarTime: FIXED_BAR_TIME,
      lastPlayedAt: 0,
      status: "active",
      createdAt: 0,
      speedSetting: 1,
    },
    activeBattle: null, // No battle → checkBattleRule path skipped
    balance: STARTING_BALANCE,
    equity: STARTING_BALANCE,
    marginUsed: 0,
  });

  // Mock the replay store's engines map with our stub.
  const mockEngine = makeMockEngine();
  const engines = new Map<string, unknown>([[symbol, mockEngine]]);
  useReplayStore.setState({
    engines: engines as never,
    currentBarTime: FIXED_BAR_TIME,
  });

  // Initialize the event queue. No appendMutation bound → flush() is
  // a no-op so events accumulate in pending and we can drain them.
  attemptEventQueue.setAppendMutation(null);
  attemptEventQueue.initialize(ATTEMPT_ID, -1);
}

function teardownTestEnvironment() {
  attemptEventQueue.reset();
  useOrderStore.getState().resetForSession();
}

/**
 * Project orderStore state to ReducerState shape. Drops fields the
 * reducer doesn't track (unrealizedPnl, status flags, sessionId, etc).
 */
function projectOrderStore(
  symbol: string,
  events: AttemptEvent[],
): ReducerState {
  const orderState = useOrderStore.getState();
  const sessionState = useSessionStore.getState();

  // Reducer: pendingOrders by id.
  const pendingOrders: Record<string, ReducerPendingOrder> = {};
  for (const o of orderState.pendingOrders) {
    pendingOrders[o.id] = {
      id: o.id,
      instrument: o.instrument,
      side: o.side,
      type: o.type,
      size: o.size,
      limitPrice: o.limitPrice,
      stopPrice: o.stopPrice,
      takeProfit: o.takeProfit,
      stopLoss: o.stopLoss,
    };
  }

  // Reducer: openPositions by id. orderStore tracks `commission` on
  // the position, but charges commission only at close — so
  // orderStore's position.commission is always 0 until close (which
  // removes it). Reducer's openPosition.commission tracks
  // accumulated entry commission (=0 in our model). Both are 0.
  // Reducer needs orderId; orderStore positions don't carry it. We
  // recover orderId from the event log: the order-fill event linked
  // each positionId to its orderId.
  const positionToOrder = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === "order-fill") {
      positionToOrder.set(ev.positionId, ev.orderId);
    }
  }
  const openPositions: Record<string, ReducerOpenPosition> = {};
  for (const p of orderState.openPositions) {
    openPositions[p.id] = {
      id: p.id,
      orderId: positionToOrder.get(p.id) ?? "",
      instrument: p.instrument,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      entryTime: p.entryTime,
      takeProfit: p.takeProfit,
      stopLoss: p.stopLoss,
      commission: 0,
    };
  }

  // closedTrades — orderStore Trade vs reducer ClosedTrade are
  // semantically equal but differently shaped. Convert.
  const closedTrades = orderState.closedTrades.map((t) => {
    return {
      positionId:
        events
          .filter((e) => e.type === "position-stop")
          .find((e, _i, arr) => {
            // The Nth position-stop event matches the Nth closed
            // trade in orderStore order, since both are appended in
            // sequence. (Property tests don't reorder.)
            const closedIdx = orderState.closedTrades.findIndex(
              (ct) => ct.id === t.id,
            );
            const stopIdx = arr.indexOf(e);
            return stopIdx === closedIdx;
          })?.positionId ?? "",
      orderId: "",
      instrument: t.instrument,
      side: t.side,
      size: t.size,
      entryPrice: t.entryPrice,
      entryTime: t.entryTime,
      closePrice: t.exitPrice,
      closeTime: t.exitTime,
      closeReason: t.closeReason,
      // orderStore.trade.pnl is net of commission; reducer
      // closedTrade.realizedPnl is gross. Reverse-engineer.
      realizedPnl: t.pnl + t.commission,
      commission: t.commission,
    };
  });

  return {
    lastSeq: events.length === 0 ? -1 : events.length - 1,
    status: "in-flight",
    startingBalance: STARTING_BALANCE,
    balance: sessionState.balance,
    battleId: "battle-1",
    instruments: [symbol],
    pendingOrders,
    openPositions,
    closedTrades,
  };
}

// ---- Reducer-state vs orderStore equivalence helper ---------------------

function compareEquivalent(
  symbol: string,
  events: AttemptEvent[],
): void {
  // Reducer side: replay events from a "start"-prefixed sequence to
  // get the final reducer state.
  const start: AttemptEvent = {
    seq: 0,
    time: FIXED_BAR_TIME,
    type: "start",
    startingBalance: STARTING_BALANCE,
    battleId: "battle-1",
    instruments: [symbol],
    rules: {},
  };
  const allEvents = [start, ...events.map((e, i) => ({ ...e, seq: i + 1 }))];
  const reducerFinal = replayEvents(allEvents);

  // orderStore side: project final state, accounting for the start
  // event we prepended (it doesn't change orderStore state but
  // is part of the canonical seq numbering).
  const orderStoreFinal = projectOrderStore(symbol, allEvents);

  // Field-by-field comparison.
  expect(orderStoreFinal.balance).toBeCloseTo(reducerFinal.balance, 5);
  expect(orderStoreFinal.pendingOrders).toEqual(reducerFinal.pendingOrders);

  // openPositions: compare by id, ignoring fields the reducer
  // doesn't track. Use the projection's view directly.
  expect(Object.keys(orderStoreFinal.openPositions).sort()).toEqual(
    Object.keys(reducerFinal.openPositions).sort(),
  );
  for (const id of Object.keys(orderStoreFinal.openPositions)) {
    const a = orderStoreFinal.openPositions[id];
    const b = reducerFinal.openPositions[id];
    expect(a.instrument).toBe(b.instrument);
    expect(a.side).toBe(b.side);
    expect(a.size).toBe(b.size);
    expect(a.entryPrice).toBeCloseTo(b.entryPrice, 5);
    expect(a.entryTime).toBe(b.entryTime);
    expect(a.takeProfit).toBe(b.takeProfit);
    expect(a.stopLoss).toBe(b.stopLoss);
  }

  // closedTrades: compare count + each trade's economics.
  expect(orderStoreFinal.closedTrades.length).toBe(
    reducerFinal.closedTrades.length,
  );
  for (let i = 0; i < orderStoreFinal.closedTrades.length; i++) {
    const a = orderStoreFinal.closedTrades[i];
    const b = reducerFinal.closedTrades[i];
    expect(a.instrument).toBe(b.instrument);
    expect(a.side).toBe(b.side);
    expect(a.size).toBe(b.size);
    expect(a.entryPrice).toBeCloseTo(b.entryPrice, 5);
    expect(a.closePrice).toBeCloseTo(b.closePrice, 5);
    expect(a.closeReason).toBe(b.closeReason);
    expect(a.realizedPnl).toBeCloseTo(b.realizedPnl, 4);
    expect(a.commission).toBeCloseTo(b.commission, 4);
  }
}

// ---- Action commands ----------------------------------------------------

type Action =
  | { kind: "market-buy"; size: number }
  | { kind: "market-sell"; size: number }
  | {
      kind: "submit-limit";
      side: "buy" | "sell";
      size: number;
      limitPrice: number;
    }
  | { kind: "cancel-pending"; index: number }
  | {
      kind: "modify-pending";
      index: number;
      changes: { limitPrice?: number; stopLoss?: number };
    }
  | {
      kind: "modify-open";
      index: number;
      changes: { tp?: number; sl?: number };
    }
  | { kind: "close-open"; index: number };

const SYMBOL = "EURUSD";

const actionGen: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant("market-buy" as const),
    size: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    kind: fc.constant("market-sell" as const),
    size: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    kind: fc.constant("submit-limit" as const),
    side: fc.constantFrom("buy" as const, "sell" as const),
    size: fc.integer({ min: 1, max: 5 }),
    limitPrice: fc.float({ min: Math.fround(1.05), max: Math.fround(1.13), noNaN: true }),
  }),
  fc.record({
    kind: fc.constant("cancel-pending" as const),
    index: fc.integer({ min: 0, max: 5 }),
  }),
  fc.record({
    kind: fc.constant("modify-pending" as const),
    index: fc.integer({ min: 0, max: 5 }),
    changes: fc.record({
      limitPrice: fc.option(
        fc.float({ min: Math.fround(1.05), max: Math.fround(1.13), noNaN: true }),
        { nil: undefined },
      ),
      stopLoss: fc.option(
        fc.float({ min: Math.fround(1.0), max: Math.fround(1.05), noNaN: true }),
        { nil: undefined },
      ),
    }),
  }),
  fc.record({
    kind: fc.constant("modify-open" as const),
    index: fc.integer({ min: 0, max: 5 }),
    changes: fc.record({
      tp: fc.option(
        fc.float({ min: Math.fround(1.0), max: Math.fround(1.2), noNaN: true }),
        { nil: undefined },
      ),
      sl: fc.option(
        fc.float({ min: Math.fround(1.0), max: Math.fround(1.2), noNaN: true }),
        { nil: undefined },
      ),
    }),
  }),
  fc.record({
    kind: fc.constant("close-open" as const),
    index: fc.integer({ min: 0, max: 5 }),
  }),
);

async function applyAction(action: Action): Promise<void> {
  const order = useOrderStore.getState();
  switch (action.kind) {
    case "market-buy":
      await order.submitOrder({
        sessionId: SESSION_ID,
        instrument: SYMBOL,
        side: "buy",
        type: "market",
        size: action.size,
      });
      break;
    case "market-sell":
      await order.submitOrder({
        sessionId: SESSION_ID,
        instrument: SYMBOL,
        side: "sell",
        type: "market",
        size: action.size,
      });
      break;
    case "submit-limit":
      await order.submitOrder({
        sessionId: SESSION_ID,
        instrument: SYMBOL,
        side: action.side,
        type: "limit",
        size: action.size,
        limitPrice: action.limitPrice,
      });
      break;
    case "cancel-pending": {
      const pending = useOrderStore.getState().pendingOrders;
      if (pending.length > 0) {
        await order.cancelOrder(pending[action.index % pending.length].id);
      }
      break;
    }
    case "modify-pending": {
      const pending = useOrderStore.getState().pendingOrders;
      if (pending.length > 0) {
        await order.modifyOrder(
          pending[action.index % pending.length].id,
          action.changes,
        );
      }
      break;
    }
    case "modify-open": {
      const open = useOrderStore.getState().openPositions;
      if (open.length > 0) {
        await order.modifyPosition(
          open[action.index % open.length].id,
          action.changes,
        );
      }
      break;
    }
    case "close-open": {
      const open = useOrderStore.getState().openPositions;
      if (open.length > 0) {
        await order.closePosition(open[action.index % open.length].id);
      }
      break;
    }
  }
}

// ---- The property test --------------------------------------------------

describe("orderStore ≡ AttemptReducer (live-mutation equivalence)", () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  it("100 random action sequences: orderStore final state matches reducer replay", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionGen, { minLength: 0, maxLength: 12 }),
        async (actions) => {
          setupTestEnvironment();
          for (const a of actions) {
            await applyAction(a);
          }
          // Drain captured events from the queue.
          const events = attemptEventQueue.__testDrain();
          compareEquivalent(SYMBOL, events);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("a few hand-rolled scenarios match (sanity)", async () => {
    setupTestEnvironment();

    // 1. Open a market buy.
    await useOrderStore.getState().submitOrder({
      sessionId: SESSION_ID,
      instrument: SYMBOL,
      side: "buy",
      type: "market",
      size: 1,
    });

    // 2. Place a limit order.
    await useOrderStore.getState().submitOrder({
      sessionId: SESSION_ID,
      instrument: SYMBOL,
      side: "sell",
      type: "limit",
      size: 1,
      limitPrice: 1.10,
    });

    // 3. Close the market position.
    const openId = useOrderStore.getState().openPositions[0].id;
    await useOrderStore.getState().closePosition(openId);

    const events = attemptEventQueue.__testDrain();
    compareEquivalent(SYMBOL, events);

    // Spot-check: balance equals starting - close commission (one round-turn).
    const inst = getInstrument(SYMBOL);
    const expectedCommission = computeCommission(inst, 1);
    // Close at 1.09 from entry 1.09 → grossPnl = 0; net = -commission.
    expect(useSessionStore.getState().balance).toBeCloseTo(
      STARTING_BALANCE - expectedCommission,
      4,
    );
  });
});
