import type { Bar } from "@/types/bar";
import type { Instrument } from "@/types/instrument";
import type { Order, OrderSide } from "@/types/order";
import type {
  Position,
  PositionCloseReason,
} from "@/types/position";
import type { Trade } from "@/types/trade";

export interface Fill {
  orderId: string;
  filledPrice: number;
  filledAt: number;
  position: Position;
}

export interface PositionClosure {
  positionId: string;
  closePrice: number;
  closeTime: number;
  reason: PositionCloseReason;
  realizedPnl: number;
  commission: number;
  trade: Trade;
}

export interface OrderRejection {
  orderId: string;
  reason: string;
}

export interface ProcessBarInput {
  bar: Bar;
  pendingOrders: Order[];
  openPositions: Position[];
  instrument: Instrument;
  /** Account balance + sum of all unrealized P&L on entry to this bar. Used to detect liquidation. */
  equityCheck?: { balance: number };
  /** Override id generator (tests rely on determinism). */
  idGen?: () => string;
}

export interface ProcessBarResult {
  fills: Fill[];
  closures: PositionClosure[];
  rejections: OrderRejection[];
  /** True if liquidation triggered this bar — caller should treat all positions as closed. */
  liquidated: boolean;
}

const directionFor = (side: OrderSide): 1 | -1 => (side === "buy" ? 1 : -1);

/**
 * Convert a price delta into USD P&L for one unit of `size`.
 * Forex:    delta * contractSize        (so EURUSD: 0.0001 * 100,000 = $10/pip per lot)
 * Futures:  delta / tickSize * tickValue (so NQ:    0.25  / 0.25     * $5 = $5/tick per contract)
 *
 * Both reduce to: delta * pricePerUnit, where pricePerUnit is unique per instrument.
 */
function pricePerUnit(instrument: Instrument): number {
  return instrument.class === "forex"
    ? instrument.contractSize
    : instrument.tickValue / instrument.tickSize;
}

export function computePnl(
  instrument: Instrument,
  side: OrderSide,
  entryPrice: number,
  exitPrice: number,
  size: number,
): number {
  return (exitPrice - entryPrice) * pricePerUnit(instrument) * size * directionFor(side);
}

export function computePips(
  instrument: Instrument,
  side: OrderSide,
  entryPrice: number,
  exitPrice: number,
): number {
  return ((exitPrice - entryPrice) / instrument.pipSize) * directionFor(side);
}

export function computeCommission(instrument: Instrument, size: number): number {
  // Per spec §6: round-turn deducted at close.
  return instrument.commission * size * 2;
}

let _idCounter = 0;
const defaultIdGen = () => `g_${Date.now().toString(36)}_${(++_idCounter).toString(36)}`;

/**
 * Process a single bar: fills pending orders, closes positions on TP/SL, applies liquidation.
 *
 * Pure function — does NOT mutate inputs. Returns events the caller applies to state.
 *
 * Intra-bar order (per spec §5):
 *   1. Open positions — check TP/SL against bar.high / bar.low.
 *      If both hit in the same bar, SL fills first (worst case, conservative).
 *   2. Pending orders — market fills at bar.open, limit/stop fill if range crosses trigger.
 *   3. Liquidation check — if balance + total unrealized < 0, liquidate everything at close.
 */
export function processBar(input: ProcessBarInput): ProcessBarResult {
  const { bar, pendingOrders, openPositions, instrument, equityCheck } = input;
  const idGen = input.idGen ?? defaultIdGen;

  const fills: Fill[] = [];
  const closures: PositionClosure[] = [];
  const rejections: OrderRejection[] = [];

  // --- 1. TP/SL on existing positions ---
  // Track which positions stayed open after this bar so liquidation can see them.
  const stillOpen: Position[] = [];

  for (const pos of openPositions) {
    // Defensive temporal guard: never close a position based on a bar that
    // occurred BEFORE its entry. This kicks in when the user scrubs back
    // past a position's entry point — without this, TP/SL would
    // retroactively trigger on historical bars the position didn't exist
    // in. See replayStore.maxReachedIndex / scrubber lock-zone.
    if (pos.entryTime > bar.time) {
      stillOpen.push(pos);
      continue;
    }
    const closure = checkPositionTriggers(pos, bar, instrument);
    if (closure) {
      closures.push(closure);
    } else {
      stillOpen.push(pos);
    }
  }

  // --- 2. Pending orders ---
  // Market orders first (unconditional fill at open), then limit/stop in submission order.
  const sorted = [...pendingOrders].sort((a, b) => {
    if (a.type === "market" && b.type !== "market") return -1;
    if (b.type === "market" && a.type !== "market") return 1;
    return a.createdAt - b.createdAt;
  });

  for (const order of sorted) {
    // Same temporal guard for orders: don't fill against bars submitted
    // AFTER this bar (would be a retroactive fill on backward scrub).
    if (order.createdAt > bar.time) continue;
    const fillResult = fillOrder(order, bar, instrument, idGen);
    if (fillResult.kind === "filled") {
      fills.push(fillResult.fill);
      stillOpen.push(fillResult.fill.position);
    } else if (fillResult.kind === "rejected") {
      rejections.push({ orderId: order.id, reason: fillResult.reason });
    }
    // "waiting" — order remains pending, no event.
  }

  // --- 3. Liquidation check ---
  let liquidated = false;
  if (equityCheck) {
    const totalUnrealized = stillOpen.reduce(
      (sum, p) => sum + computePnl(instrument, p.side, p.entryPrice, bar.close, p.size),
      0,
    );
    if (equityCheck.balance + totalUnrealized < 0) {
      liquidated = true;
      for (const pos of stillOpen) {
        closures.push(makeClosure(pos, bar.close, bar.time, "liquidated", instrument, idGen));
      }
    }
  }

  return { fills, closures, rejections, liquidated };
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function checkPositionTriggers(
  pos: Position,
  bar: Bar,
  instrument: Instrument,
): PositionClosure | null {
  const { stopLoss: sl, takeProfit: tp, side } = pos;

  // Long: SL below entry (bar.low <= sl), TP above entry (bar.high >= tp).
  // Short: SL above entry (bar.high >= sl), TP below entry (bar.low <= tp).
  const slHit =
    sl !== undefined && (side === "buy" ? bar.low <= sl : bar.high >= sl);
  const tpHit =
    tp !== undefined && (side === "buy" ? bar.high >= tp : bar.low <= tp);

  // SL wins when both hit in the same bar (worst case, conservative — see spec §6).
  if (slHit) {
    return makeClosure(pos, sl as number, bar.time, "sl", instrument);
  }
  if (tpHit) {
    return makeClosure(pos, tp as number, bar.time, "tp", instrument);
  }
  return null;
}

type FillResult =
  | { kind: "filled"; fill: Fill }
  | { kind: "waiting" }
  | { kind: "rejected"; reason: string };

function fillOrder(
  order: Order,
  bar: Bar,
  instrument: Instrument,
  idGen: () => string,
): FillResult {
  let filledPrice: number | null = null;

  switch (order.type) {
    case "market":
      filledPrice = bar.open;
      break;

    case "limit": {
      if (order.limitPrice === undefined) {
        return { kind: "rejected", reason: "limit order missing limitPrice" };
      }
      if (order.side === "buy" && bar.low <= order.limitPrice) {
        filledPrice = Math.min(order.limitPrice, bar.open);
      } else if (order.side === "sell" && bar.high >= order.limitPrice) {
        filledPrice = Math.max(order.limitPrice, bar.open);
      }
      break;
    }

    case "stop": {
      if (order.stopPrice === undefined) {
        return { kind: "rejected", reason: "stop order missing stopPrice" };
      }
      if (order.side === "buy" && bar.high >= order.stopPrice) {
        filledPrice = Math.max(order.stopPrice, bar.open);
      } else if (order.side === "sell" && bar.low <= order.stopPrice) {
        filledPrice = Math.min(order.stopPrice, bar.open);
      }
      break;
    }
  }

  if (filledPrice === null) return { kind: "waiting" };

  const position: Position = {
    id: idGen(),
    sessionId: order.sessionId,
    instrument: order.instrument,
    side: order.side,
    size: order.size,
    entryPrice: filledPrice,
    entryTime: bar.time,
    takeProfit: order.takeProfit,
    stopLoss: order.stopLoss,
    unrealizedPnl: 0,
    realizedPnl: 0,
    commission: 0,
    status: "open",
  };

  return {
    kind: "filled",
    fill: { orderId: order.id, filledPrice, filledAt: bar.time, position },
  };
}

function makeClosure(
  pos: Position,
  closePrice: number,
  closeTime: number,
  reason: PositionCloseReason,
  instrument: Instrument,
  idGen: () => string = defaultIdGen,
): PositionClosure {
  const grossPnl = computePnl(instrument, pos.side, pos.entryPrice, closePrice, pos.size);
  const commission = computeCommission(instrument, pos.size);
  const realizedPnl = grossPnl - commission;
  const pips = computePips(instrument, pos.side, pos.entryPrice, closePrice);

  const trade: Trade = {
    id: idGen(),
    sessionId: pos.sessionId,
    instrument: pos.instrument,
    side: pos.side,
    size: pos.size,
    entryPrice: pos.entryPrice,
    entryTime: pos.entryTime,
    exitPrice: closePrice,
    exitTime: closeTime,
    pnl: realizedPnl,
    pips,
    commission,
    duration: closeTime - pos.entryTime,
    closeReason: reason,
  };

  return {
    positionId: pos.id,
    closePrice,
    closeTime,
    reason,
    realizedPnl,
    commission,
    trade,
  };
}
