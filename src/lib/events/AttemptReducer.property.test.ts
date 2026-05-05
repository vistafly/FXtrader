/**
 * Property-based tests for AttemptReducer (per the v2.3 plan).
 *
 * Sub-phase 1 scope: at least 3 event types verified via fast-check
 * sequences, plus the seq-gap rejection safety property. Sub-phase 2
 * adds the live-mutation ≡ reducer equivalence test (needs the
 * orderStore wiring that ships with sub-phase 2).
 *
 * Run count target per the v2.3 plan: 100 sequences per event type.
 * fast-check default `numRuns` is 100.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  AttemptEvent,
  CancelOrderEvent,
  ModifyOrderEvent,
  StartEvent,
  SubmitOrderEvent,
} from "./AttemptEvent";
import {
  applyEvent,
  initialReducerState,
  ReducerSeqGapError,
  replayEvents,
} from "./AttemptReducer";

// ---- Generators ----------------------------------------------------------

const startGen = (seq: number): fc.Arbitrary<StartEvent> =>
  fc.record({
    seq: fc.constant(seq),
    time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
    type: fc.constant("start" as const),
    startingBalance: fc.integer({ min: 1_000, max: 1_000_000 }),
    battleId: fc.string({ minLength: 1, maxLength: 20 }),
    instruments: fc.array(fc.constantFrom("EURUSD", "GBPUSD", "NQ1!"), {
      minLength: 1,
      maxLength: 3,
    }),
    rules: fc.constant({}),
  });

const submitOrderGen = (
  seq: number,
  orderId: string,
): fc.Arbitrary<SubmitOrderEvent> =>
  fc.record({
    seq: fc.constant(seq),
    time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
    type: fc.constant("submit-order" as const),
    orderId: fc.constant(orderId),
    instrument: fc.constantFrom("EURUSD", "GBPUSD", "NQ1!"),
    side: fc.constantFrom("buy" as const, "sell" as const),
    orderType: fc.constantFrom("market" as const, "limit" as const, "stop" as const),
    size: fc.integer({ min: 1, max: 10 }),
    limitPrice: fc.option(fc.float({ min: Math.fround(1), max: Math.fround(2), noNaN: true }), { nil: undefined }),
    stopPrice: fc.option(fc.float({ min: Math.fround(1), max: Math.fround(2), noNaN: true }), { nil: undefined }),
    stopLoss: fc.option(fc.float({ min: Math.fround(0.5), max: Math.fround(1.5), noNaN: true }), { nil: undefined }),
    takeProfit: fc.option(fc.float({ min: Math.fround(1.5), max: Math.fround(2.5), noNaN: true }), { nil: undefined }),
  });

const cancelOrderGen = (
  seq: number,
  orderId: string,
): fc.Arbitrary<CancelOrderEvent> =>
  fc.record({
    seq: fc.constant(seq),
    time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
    type: fc.constant("cancel-order" as const),
    orderId: fc.constant(orderId),
  });

const modifyOrderGen = (
  seq: number,
  orderId: string,
): fc.Arbitrary<ModifyOrderEvent> =>
  fc.record({
    seq: fc.constant(seq),
    time: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
    type: fc.constant("modify-order" as const),
    orderId: fc.constant(orderId),
    changes: fc.record({
      limitPrice: fc.option(fc.float({ min: Math.fround(1), max: Math.fround(2), noNaN: true }), { nil: undefined }),
      stopLoss: fc.option(fc.float({ min: Math.fround(0.5), max: Math.fround(1.5), noNaN: true }), { nil: undefined }),
    }),
  });

/**
 * Build a valid event sequence: start, then some submit-orders with
 * unique ids, then some cancel-orders / modify-orders against orders
 * that exist at that point. Sequence is well-formed by construction so
 * the reducer never throws.
 */
function validSequenceGen(): fc.Arbitrary<AttemptEvent[]> {
  return fc
    .integer({ min: 0, max: 8 }) // number of submit-orders
    .chain((nSubmits) =>
      fc
        .integer({ min: 0, max: nSubmits }) // number of cancels (≤ submits)
        .chain((nCancels) =>
          fc
            .integer({ min: 0, max: nSubmits }) // number of modifies
            .chain((nModifies) => {
              const orderIds = Array.from({ length: nSubmits }, (_, i) => `ord-${i}`);
              const submitArbs = orderIds.map((id, i) =>
                submitOrderGen(i + 1, id),
              );
              // Cancel the first nCancels orders.
              const cancelArbs = orderIds
                .slice(0, nCancels)
                .map((id, i) =>
                  cancelOrderGen(nSubmits + 1 + i, id),
                );
              // Modify the orders that haven't been cancelled.
              const modifyTargets = orderIds.slice(nCancels);
              const modifyArbs = modifyTargets
                .slice(0, nModifies)
                .map((id, i) =>
                  modifyOrderGen(nSubmits + 1 + nCancels + i, id),
                );
              const all = [...submitArbs, ...cancelArbs, ...modifyArbs];
              return fc
                .tuple(startGen(0), ...all)
                .map(([startEvent, ...rest]) => [startEvent, ...rest] as AttemptEvent[]);
            }),
        ),
    );
}

// ---- Properties ----------------------------------------------------------

describe("AttemptReducer property tests", () => {
  it("start: replay produces the same state as step-by-step apply (100 runs)", () => {
    fc.assert(
      fc.property(startGen(0), (start) => {
        const stepwise = applyEvent(initialReducerState(), start);
        const replayed = replayEvents([start]);
        expect(replayed).toEqual(stepwise);
        expect(replayed.lastSeq).toBe(0);
        expect(replayed.status).toBe("in-flight");
      }),
    );
  });

  it("submit-order: every generated submit lands in pendingOrders (100 runs)", () => {
    fc.assert(
      fc.property(
        startGen(0),
        submitOrderGen(1, "ord-1"),
        (start, submit) => {
          let state = applyEvent(initialReducerState(), start);
          state = applyEvent(state, submit);
          expect(state.pendingOrders["ord-1"]).toBeDefined();
          expect(state.pendingOrders["ord-1"].id).toBe("ord-1");
          expect(state.lastSeq).toBe(1);
        },
      ),
    );
  });

  it("cancel-order: cancel after submit removes the order (100 runs)", () => {
    fc.assert(
      fc.property(
        startGen(0),
        submitOrderGen(1, "ord-1"),
        cancelOrderGen(2, "ord-1"),
        (start, submit, cancel) => {
          let state = applyEvent(initialReducerState(), start);
          state = applyEvent(state, submit);
          state = applyEvent(state, cancel);
          expect(state.pendingOrders).toEqual({});
          expect(state.lastSeq).toBe(2);
        },
      ),
    );
  });

  it("modify-order: changes merge correctly (100 runs)", () => {
    fc.assert(
      fc.property(
        startGen(0),
        submitOrderGen(1, "ord-1"),
        modifyOrderGen(2, "ord-1"),
        (start, submit, modify) => {
          let state = applyEvent(initialReducerState(), start);
          state = applyEvent(state, submit);
          const before = state.pendingOrders["ord-1"];
          state = applyEvent(state, modify);
          const after = state.pendingOrders["ord-1"];
          // Fields not in `changes` are preserved.
          expect(after.id).toBe(before.id);
          expect(after.size).toBe(before.size);
          expect(after.side).toBe(before.side);
          expect(after.type).toBe(before.type);
          // Fields in `changes` are applied (including explicit undefined → cleared).
          if ("limitPrice" in modify.changes) {
            expect(after.limitPrice).toBe(modify.changes.limitPrice);
          }
          if ("stopLoss" in modify.changes) {
            expect(after.stopLoss).toBe(modify.changes.stopLoss);
          }
        },
      ),
    );
  });

  it("seq gap (concern 3): inserting any non-contiguous seq throws ReducerSeqGapError (100 runs)", () => {
    fc.assert(
      fc.property(
        startGen(0),
        submitOrderGen(1, "ord-1"),
        // Pick any seq != 2 to apply next; the reducer expects 2 here
        // (lastSeq was 1). Generate around the boundary plus far-away values.
        fc.integer({ min: -10, max: 50 }).filter((n) => n !== 2),
        (start, submit, badSeq) => {
          let state = applyEvent(initialReducerState(), start);
          state = applyEvent(state, submit);
          expect(() =>
            applyEvent(state, {
              seq: badSeq,
              time: 1_700_000_300,
              type: "cancel-order",
              orderId: "ord-1",
            }),
          ).toThrow(ReducerSeqGapError);
        },
      ),
    );
  });

  it("determinism: replaying the same sequence twice yields equal states (100 runs)", () => {
    fc.assert(
      fc.property(validSequenceGen(), (events) => {
        const s1 = replayEvents(events);
        const s2 = replayEvents(events);
        expect(s1).toEqual(s2);
        expect(s1.lastSeq).toBe(events.length - 1);
      }),
    );
  });

  it("composition: replay([a, b]) === apply(replay([a]), b) (100 runs)", () => {
    fc.assert(
      fc.property(validSequenceGen(), (events) => {
        if (events.length < 2) return;
        const split = Math.floor(events.length / 2);
        const head = events.slice(0, split);
        const tail = events.slice(split);
        const fullReplay = replayEvents(events);
        const splitReplay = tail.reduce(
          (s, e) => applyEvent(s, e),
          replayEvents(head),
        );
        expect(splitReplay).toEqual(fullReplay);
      }),
    );
  });

  // ---- Property coverage for the remaining event types (per the
  // sub-phase 2 deliverable: all 11 event types must have property
  // tests). These exercise individual reducer transitions with
  // randomized payloads.

  it("modify-position: SL/TP changes apply to the targeted position (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(1.0), max: Math.fround(1.5), noNaN: true }),
        fc.float({ min: Math.fround(1.5), max: Math.fround(2.0), noNaN: true }),
        (newSl, newTp) => {
          // Bootstrap: start → submit-order → order-fill → modify-position.
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "submit-order",
              orderId: "ord-1",
              instrument: "EURUSD",
              side: "buy",
              orderType: "market",
              size: 1,
            },
            {
              seq: 2,
              time: 1_700_000_120,
              type: "order-fill",
              orderId: "ord-1",
              positionId: "pos-1",
              fillPrice: 1.09,
              commission: 0,
            },
            {
              seq: 3,
              time: 1_700_000_180,
              type: "modify-position",
              positionId: "pos-1",
              changes: { stopLoss: newSl, takeProfit: newTp },
            },
          ];
          const state = replayEvents(events);
          expect(state.openPositions["pos-1"].stopLoss).toBe(newSl);
          expect(state.openPositions["pos-1"].takeProfit).toBe(newTp);
        },
      ),
    );
  });

  it("close-position: validates the position exists, leaves state intact (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("buy" as const, "sell" as const),
        fc.integer({ min: 1, max: 10 }),
        (side, size) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "submit-order",
              orderId: "ord-1",
              instrument: "EURUSD",
              side,
              orderType: "market",
              size,
            },
            {
              seq: 2,
              time: 1_700_000_120,
              type: "order-fill",
              orderId: "ord-1",
              positionId: "pos-1",
              fillPrice: 1.09,
              commission: 0,
            },
            {
              seq: 3,
              time: 1_700_000_180,
              type: "close-position",
              positionId: "pos-1",
            },
          ];
          const state = replayEvents(events);
          // close-position is intent only — position still open until
          // matching position-stop arrives.
          expect(state.openPositions["pos-1"]).toBeDefined();
          expect(state.lastSeq).toBe(3);
        },
      ),
    );
  });

  it("order-fill: random fillPrice transforms pending order into open position (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(1.05), max: Math.fround(1.15), noNaN: true }),
        fc.float({ min: 0, max: 10, noNaN: true }),
        (fillPrice, commission) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "submit-order",
              orderId: "ord-1",
              instrument: "EURUSD",
              side: "buy",
              orderType: "limit",
              size: 1,
              limitPrice: fillPrice,
            },
            {
              seq: 2,
              time: 1_700_000_120,
              type: "order-fill",
              orderId: "ord-1",
              positionId: "pos-1",
              fillPrice,
              commission,
            },
          ];
          const state = replayEvents(events);
          expect(state.pendingOrders).toEqual({});
          expect(state.openPositions["pos-1"].entryPrice).toBe(fillPrice);
          expect(state.balance).toBeCloseTo(10_000 - commission, 6);
        },
      ),
    );
  });

  it("position-stop: realized P&L flows into balance (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-200), max: Math.fround(200), noNaN: true }),
        fc.float({ min: 0, max: 10, noNaN: true }),
        fc.constantFrom("manual" as const, "tp" as const, "sl" as const),
        (realizedPnl, commission, reason) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "submit-order",
              orderId: "ord-1",
              instrument: "EURUSD",
              side: "buy",
              orderType: "market",
              size: 1,
            },
            {
              seq: 2,
              time: 1_700_000_120,
              type: "order-fill",
              orderId: "ord-1",
              positionId: "pos-1",
              fillPrice: 1.09,
              commission: 0,
            },
            {
              seq: 3,
              time: 1_700_000_180,
              type: "position-stop",
              positionId: "pos-1",
              reason,
              closePrice: 1.10,
              realizedPnl,
              commission,
            },
          ];
          const state = replayEvents(events);
          expect(state.openPositions).toEqual({});
          expect(state.closedTrades).toHaveLength(1);
          expect(state.closedTrades[0].closeReason).toBe(reason);
          expect(state.balance).toBeCloseTo(
            10_000 + realizedPnl - commission,
            6,
          );
        },
      ),
    );
  });

  it("liquidation: any rule breach flips status to liquidated (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "maxDrawdown" as const,
          "maxLossPerTrade" as const,
          "other" as const,
        ),
        fc.float({ min: Math.fround(-100), max: Math.fround(100), noNaN: true }),
        (rule, pnlPct) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "liquidation",
              ruleBreached: rule,
              finalBalance: 9_000,
              pnlPct,
            },
          ];
          const state = replayEvents(events);
          expect(state.status).toBe("liquidated");
          expect(state.liquidation?.ruleBreached).toBe(rule);
        },
      ),
    );
  });

  it("bar-tick: any time advances seq but leaves state intact (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
        (time) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            { seq: 1, time, type: "bar-tick" },
          ];
          const state = replayEvents(events);
          expect(state.lastSeq).toBe(1);
          expect(state.balance).toBe(10_000);
          expect(state.status).toBe("in-flight");
        },
      ),
    );
  });

  it("submit-final: any final stats flip status to completed (100 runs)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: Math.fround(1_000_000), noNaN: true }),
        fc.float({ min: Math.fround(-100), max: Math.fround(1000), noNaN: true }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.float({ min: 0, max: 100, noNaN: true }),
        (finalBalance, pnlPct, trades, winRate) => {
          const events: AttemptEvent[] = [
            {
              seq: 0,
              time: 1_700_000_000,
              type: "start",
              startingBalance: 10_000,
              battleId: "b",
              instruments: ["EURUSD"],
              rules: {},
            },
            {
              seq: 1,
              time: 1_700_000_060,
              type: "submit-final",
              finalBalance,
              pnlPct,
              trades,
              winRate,
            },
          ];
          const state = replayEvents(events);
          expect(state.status).toBe("completed");
          expect(state.finalizedAt).toBe(1_700_000_060);
        },
      ),
    );
  });
});
