/**
 * v2.3 D1: pure reducer that reconstructs attempt state from an event
 * sequence. Used on resume (replay all events) and by the
 * property-based equivalence tests (random sequences → reducer state
 * equals live-mutation state).
 *
 * Concern 3 (locked): the reducer MUST throw on missing seq numbers,
 * not silently skip. If client appends events 0, 1, 3 because event 2
 * failed to write, replaying [0, 1, 3] would silently produce wrong
 * state. Loud failure ("your attempt couldn't be resumed due to a
 * sync gap") is far better than silent drift.
 */

import type { OrderSide, OrderType } from "@/types/order";
import type { PositionCloseReason } from "@/types/position";

import type { AttemptEvent } from "./AttemptEvent";

/** Pure-data view of a pending order, sufficient for the reducer. */
export interface ReducerPendingOrder {
  id: string;
  instrument: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
}

/** Pure-data view of an open position. */
export interface ReducerOpenPosition {
  id: string;
  /** The submit-order or order-fill event's matching orderId (for
   *  joining the live engine's order-id space if needed). */
  orderId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  takeProfit?: number;
  stopLoss?: number;
  /** Sum of fill commission + (eventual) close commission paid so
   *  far. Reducer subtracts from balance at the position-stop event. */
  commission: number;
}

/** Pure-data view of a closed trade. */
export interface ReducerClosedTrade {
  positionId: string;
  orderId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  closePrice: number;
  closeTime: number;
  closeReason: PositionCloseReason;
  realizedPnl: number;
  commission: number;
}

/** Reducer state. Records keyed by id (vs. arrays) so deep-equality
 *  comparisons in property tests don't depend on insertion order. */
export interface ReducerState {
  /** Last applied event seq. -1 before any event. */
  lastSeq: number;
  status:
    | "pending-start"
    | "in-flight"
    | "liquidated"
    | "completed"
    | "abandoned";
  startingBalance: number;
  /** Realized cash balance (commission subtracted, realized P&L
   *  applied). Open-position unrealized is NOT in this number; the
   *  live engine recomputes that from the current bar. */
  balance: number;
  battleId?: string;
  instruments: string[];
  pendingOrders: Record<string, ReducerPendingOrder>;
  openPositions: Record<string, ReducerOpenPosition>;
  closedTrades: ReducerClosedTrade[];
  liquidation?: {
    ruleBreached: "maxDrawdown" | "maxLossPerTrade" | "other";
    time: number;
  };
  /** Set when submit-final event applied. */
  finalizedAt?: number;
}

export class ReducerSeqGapError extends Error {
  expected: number;
  received: number;
  constructor(expected: number, received: number) {
    super(
      `Attempt event seq gap: expected ${expected}, received ${received}. The attempt's event log is non-contiguous and cannot be safely replayed.`,
    );
    this.expected = expected;
    this.received = received;
    this.name = "ReducerSeqGapError";
  }
}

export class ReducerInvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReducerInvalidEventError";
  }
}

/**
 * Initial state before any events. Once the `start` event applies,
 * status flips to "in-flight" and `startingBalance`/`battleId`/
 * `instruments` are filled in.
 */
export function initialReducerState(): ReducerState {
  return {
    lastSeq: -1,
    status: "pending-start",
    startingBalance: 0,
    balance: 0,
    instruments: [],
    pendingOrders: {},
    openPositions: {},
    closedTrades: [],
  };
}

/**
 * Apply one event to the state, returning a new state. Pure; does NOT
 * mutate input. Throws ReducerSeqGapError on non-contiguous seq.
 *
 * Order-of-checks rationale:
 *   1. Seq gap — first because nothing else matters if we lost an
 *      event. Loud failure beats silent drift.
 *   2. State machine transitions — events that don't make sense in
 *      the current status (e.g. submit-order on a finalized attempt)
 *      throw ReducerInvalidEventError so test failures are obvious.
 *   3. Event-specific reducer logic.
 */
export function applyEvent(
  state: ReducerState,
  event: AttemptEvent,
): ReducerState {
  // 1. Seq-contiguity check.
  const expected = state.lastSeq + 1;
  if (event.seq !== expected) {
    throw new ReducerSeqGapError(expected, event.seq);
  }

  // 2. State machine: only "start" is valid before in-flight; nothing
  //    is valid after finalization or abandonment.
  if (state.status === "pending-start" && event.type !== "start") {
    throw new ReducerInvalidEventError(
      `First event must be "start", got "${event.type}"`,
    );
  }
  if (
    (state.status === "completed" || state.status === "abandoned") &&
    event.type !== "submit-final"
  ) {
    throw new ReducerInvalidEventError(
      `Cannot apply "${event.type}" to ${state.status} attempt`,
    );
  }

  switch (event.type) {
    case "start": {
      if (state.status !== "pending-start") {
        throw new ReducerInvalidEventError(
          `Duplicate "start" event at seq ${event.seq}`,
        );
      }
      return {
        ...state,
        lastSeq: event.seq,
        status: "in-flight",
        startingBalance: event.startingBalance,
        balance: event.startingBalance,
        battleId: event.battleId,
        instruments: event.instruments.slice(),
      };
    }

    case "submit-order": {
      if (state.pendingOrders[event.orderId]) {
        throw new ReducerInvalidEventError(
          `Duplicate orderId ${event.orderId} in submit-order at seq ${event.seq}`,
        );
      }
      const order: ReducerPendingOrder = {
        id: event.orderId,
        instrument: event.instrument,
        side: event.side,
        type: event.orderType,
        size: event.size,
        limitPrice: event.limitPrice,
        stopPrice: event.stopPrice,
        takeProfit: event.takeProfit,
        stopLoss: event.stopLoss,
      };
      return {
        ...state,
        lastSeq: event.seq,
        pendingOrders: { ...state.pendingOrders, [event.orderId]: order },
      };
    }

    case "cancel-order": {
      if (!state.pendingOrders[event.orderId]) {
        // Idempotent-ish: silently skipping would hide bugs. Throw.
        throw new ReducerInvalidEventError(
          `cancel-order for unknown orderId ${event.orderId} at seq ${event.seq}`,
        );
      }
      const next = { ...state.pendingOrders };
      delete next[event.orderId];
      return {
        ...state,
        lastSeq: event.seq,
        pendingOrders: next,
      };
    }

    case "modify-order": {
      const existing = state.pendingOrders[event.orderId];
      if (!existing) {
        throw new ReducerInvalidEventError(
          `modify-order for unknown orderId ${event.orderId} at seq ${event.seq}`,
        );
      }
      const merged: ReducerPendingOrder = {
        ...existing,
        // Use `in` semantics: undefined in changes means "clear", same
        // as orderStore.modifyOrder.
        ...("limitPrice" in event.changes
          ? { limitPrice: event.changes.limitPrice }
          : {}),
        ...("stopPrice" in event.changes
          ? { stopPrice: event.changes.stopPrice }
          : {}),
        ...("takeProfit" in event.changes
          ? { takeProfit: event.changes.takeProfit }
          : {}),
        ...("stopLoss" in event.changes
          ? { stopLoss: event.changes.stopLoss }
          : {}),
      };
      return {
        ...state,
        lastSeq: event.seq,
        pendingOrders: {
          ...state.pendingOrders,
          [event.orderId]: merged,
        },
      };
    }

    case "modify-position": {
      const existing = state.openPositions[event.positionId];
      if (!existing) {
        throw new ReducerInvalidEventError(
          `modify-position for unknown positionId ${event.positionId} at seq ${event.seq}`,
        );
      }
      const merged: ReducerOpenPosition = {
        ...existing,
        ...("takeProfit" in event.changes
          ? { takeProfit: event.changes.takeProfit }
          : {}),
        ...("stopLoss" in event.changes
          ? { stopLoss: event.changes.stopLoss }
          : {}),
      };
      return {
        ...state,
        lastSeq: event.seq,
        openPositions: {
          ...state.openPositions,
          [event.positionId]: merged,
        },
      };
    }

    case "close-position": {
      // Intent-only — no state mutation. The matching position-stop
      // event from the engine carries the actual close price + P&L
      // and is what mutates state.
      if (!state.openPositions[event.positionId]) {
        throw new ReducerInvalidEventError(
          `close-position for unknown positionId ${event.positionId} at seq ${event.seq}`,
        );
      }
      return { ...state, lastSeq: event.seq };
    }

    case "order-fill": {
      const order = state.pendingOrders[event.orderId];
      if (!order) {
        throw new ReducerInvalidEventError(
          `order-fill for unknown orderId ${event.orderId} at seq ${event.seq}`,
        );
      }
      if (state.openPositions[event.positionId]) {
        throw new ReducerInvalidEventError(
          `Duplicate positionId ${event.positionId} in order-fill at seq ${event.seq}`,
        );
      }
      const newPending = { ...state.pendingOrders };
      delete newPending[event.orderId];
      const position: ReducerOpenPosition = {
        id: event.positionId,
        orderId: event.orderId,
        instrument: order.instrument,
        side: order.side,
        size: order.size,
        entryPrice: event.fillPrice,
        entryTime: event.time,
        takeProfit: order.takeProfit,
        stopLoss: order.stopLoss,
        commission: event.commission,
      };
      return {
        ...state,
        lastSeq: event.seq,
        pendingOrders: newPending,
        openPositions: {
          ...state.openPositions,
          [event.positionId]: position,
        },
        // Commission paid up-front per side; balance reflects that.
        balance: state.balance - event.commission,
      };
    }

    case "position-stop": {
      const position = state.openPositions[event.positionId];
      if (!position) {
        throw new ReducerInvalidEventError(
          `position-stop for unknown positionId ${event.positionId} at seq ${event.seq}`,
        );
      }
      const newOpen = { ...state.openPositions };
      delete newOpen[event.positionId];
      const totalCommission = position.commission + event.commission;
      const closedTrade: ReducerClosedTrade = {
        positionId: position.id,
        orderId: position.orderId,
        instrument: position.instrument,
        side: position.side,
        size: position.size,
        entryPrice: position.entryPrice,
        entryTime: position.entryTime,
        closePrice: event.closePrice,
        closeTime: event.time,
        closeReason: event.reason,
        realizedPnl: event.realizedPnl,
        commission: totalCommission,
      };
      return {
        ...state,
        lastSeq: event.seq,
        openPositions: newOpen,
        closedTrades: [...state.closedTrades, closedTrade],
        // Realized P&L flows in; close-side commission flows out.
        // (Entry commission was already deducted in order-fill.)
        balance:
          state.balance + event.realizedPnl - event.commission,
      };
    }

    case "liquidation": {
      return {
        ...state,
        lastSeq: event.seq,
        status: "liquidated",
        liquidation: {
          ruleBreached: event.ruleBreached,
          time: event.time,
        },
      };
    }

    case "bar-tick": {
      // Heartbeat / sampling marker. No state mutation beyond seq.
      return { ...state, lastSeq: event.seq };
    }

    case "submit-final": {
      if (
        state.status !== "in-flight" &&
        state.status !== "liquidated"
      ) {
        throw new ReducerInvalidEventError(
          `submit-final from invalid status ${state.status} at seq ${event.seq}`,
        );
      }
      return {
        ...state,
        lastSeq: event.seq,
        status: "completed",
        finalizedAt: event.time,
      };
    }
  }
}

/**
 * Replay a sequence of events against a fresh initial state. Convenience
 * wrapper for the common resume case. Throws on the first invalid event.
 */
export function replayEvents(events: AttemptEvent[]): ReducerState {
  let state = initialReducerState();
  for (const event of events) {
    state = applyEvent(state, event);
  }
  return state;
}
