/**
 * v2.3 D1: typed event log for resumable battle attempts.
 *
 * The event log is the authoritative record of an attempt. Every
 * state change — user action OR engine outcome — appends one event
 * to the log. Resume = fetch all events in seq order + replay through
 * AttemptReducer to reconstruct {balance, openPositions, pendingOrders,
 * closedTrades}.
 *
 * Why log engine outcomes too (order-fill / position-stop / liquidation
 * rather than re-running the engine on resume): trust the original
 * session's outputs. Re-running the engine would produce the same
 * outcomes IF the dataset and engine are perfectly deterministic
 * across versions, but subtle changes (rounding, library updates,
 * dataset re-fetches) can cause silent drift. Log = source of truth.
 *
 * Schema versioning: every event carries `seq` + `time`. The seq is
 * monotonic-+1-per-attempt, enforced server-side and verified by the
 * reducer on replay. Gaps throw ReducerSeqGapError loudly — silent
 * recovery would let state drift and would be far harder to debug
 * than a rejected resume with a clear message.
 */

import type { OrderSide, OrderType } from "@/types/order";
import type { PositionCloseReason } from "@/types/position";

/** Common envelope for every event. */
interface EventBase {
  /** Monotonic +1 per attempt; first event has seq 0. */
  seq: number;
  /**
   * UTC unix-second replay time the event represents (for engine
   * events, the bar's time; for user actions, the master clock's
   * currentBarTime when the action was issued). Distinct from
   * server-side wall-clock `_creationTime`.
   */
  time: number;
}

/** Initialize an attempt. Always seq 0. */
export interface StartEvent extends EventBase {
  type: "start";
  startingBalance: number;
  battleId: string;
  instruments: string[];
  /** Snapshot of battle.rules at start; reducer doesn't enforce them
   *  but downstream consumers (server-side rule re-check, post-
   *  attempt summary) may. */
  rules: {
    maxDrawdownPct?: number;
    maxLossPerTradePct?: number;
    requireStopLoss?: boolean;
    profitTargetPct?: number;
  };
}

/** User submitted a new order. Reducer adds to pendingOrders for
 *  limit/stop, or for market orders treats this as immediate
 *  open-position (an order-fill event follows in the log either way
 *  to keep the live-engine and reducer paths uniform). */
export interface SubmitOrderEvent extends EventBase {
  type: "submit-order";
  orderId: string;
  instrument: string;
  side: OrderSide;
  orderType: OrderType;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

/** User cancelled a pending order. */
export interface CancelOrderEvent extends EventBase {
  type: "cancel-order";
  orderId: string;
}

/** User modified a pending order (limitPrice/stopPrice/SL/TP). */
export interface ModifyOrderEvent extends EventBase {
  type: "modify-order";
  orderId: string;
  changes: {
    limitPrice?: number;
    stopPrice?: number;
    takeProfit?: number;
    stopLoss?: number;
  };
}

/** User modified an open position's SL/TP. */
export interface ModifyPositionEvent extends EventBase {
  type: "modify-position";
  positionId: string;
  changes: {
    takeProfit?: number;
    stopLoss?: number;
  };
}

/** User clicked X / "close position" on an open position. The
 *  engine produces the actual close price; this event records
 *  intent. The matching position-stop event with reason="manual"
 *  follows. */
export interface ClosePositionEvent extends EventBase {
  type: "close-position";
  positionId: string;
}

/** Engine: a pending order's trigger was hit and it filled into a
 *  new open position. Also fires for market orders (orderId =
 *  matching submit-order's orderId). */
export interface OrderFillEvent extends EventBase {
  type: "order-fill";
  orderId: string;
  positionId: string;
  fillPrice: number;
  commission: number;
}

/** Engine: an open position closed via SL hit, TP hit, manual close,
 *  or liquidation force-close. */
export interface PositionStopEvent extends EventBase {
  type: "position-stop";
  positionId: string;
  reason: PositionCloseReason;
  closePrice: number;
  realizedPnl: number;
  commission: number;
}

/** Engine: drawdown / max-loss rule breached → DQ. Force-close of
 *  open positions is recorded separately as position-stop events
 *  with reason="liquidated". */
export interface LiquidationEvent extends EventBase {
  type: "liquidation";
  ruleBreached: "maxDrawdown" | "maxLossPerTrade" | "other";
  finalBalance: number;
  pnlPct: number;
}

/**
 * Heartbeat / sampled timing marker, fired every ~60s of replay time.
 *
 * Two roles:
 *   1. D6 online detection — recent event in last 30s = online; this
 *      keeps idle users (paused, analyzing) appearing online during
 *      replay-time advance.
 *   2. Resume sanity — gives the master clock a recent `time` value
 *      to anchor against on resume (currentBarTime is the source of
 *      truth, but bar-tick events confirm the clock advanced as
 *      expected through the log).
 *
 * Reducer treats this as a no-op state-wise.
 */
export interface BarTickEvent extends EventBase {
  type: "bar-tick";
}

/** User clicked "Submit Final" — locks the attempt result. */
export interface SubmitFinalEvent extends EventBase {
  type: "submit-final";
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
}

export type AttemptEvent =
  | StartEvent
  | SubmitOrderEvent
  | CancelOrderEvent
  | ModifyOrderEvent
  | ModifyPositionEvent
  | ClosePositionEvent
  | OrderFillEvent
  | PositionStopEvent
  | LiquidationEvent
  | BarTickEvent
  | SubmitFinalEvent;

export type AttemptEventType = AttemptEvent["type"];
