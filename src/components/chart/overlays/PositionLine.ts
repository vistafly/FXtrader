/**
 * Imperative helpers that draw the canvas-rendered horizontal price lines
 * for positions and pending orders (per spec §10 + Phase 4 + Phase 5 redesign).
 *
 * Visual rules:
 *   - All lines are 1px dashed.
 *   - Entry line color is dynamic: bull-green when unrealizedPnl > 0,
 *     bear-red when ≤ 0. This mirrors FXReplay.
 *   - TP line always green (it's the profit target).
 *   - SL line always red (it's the stop).
 *   - Pending order trigger lines are dashed gray.
 *
 * Interaction with the DOM overlay layer:
 *   The canvas lines are static. Drag affordance lives in
 *   PositionDragOverlay.tsx, which renders right-edge chips on top of these
 *   lines and translates pointer events into modifyPosition / modifyOrder.
 */

import { computePnl } from "@/lib/engine/MatchingEngine";
import { getInstrument } from "@/lib/instruments/instruments";
import type { Order } from "@/types/order";
import type { Position } from "@/types/position";

import type { ChartProviderHandle } from "../ChartProvider.types";

const COLORS = {
  bull: "#16C784", // normal TP — profit target
  bear: "#EA3943", // normal SL — loss cap
  pending: "#8A8C91",
  // Anomaly-case shades, kept in sync with PositionDragOverlay.tsx.
  slProfit: "#06B6A4", // SL trailed into profit (locking gains)
  tpLoss: "#D97706",   // TP capping a loss (rare)
};

const positionEntryId = (id: string) => `pos-${id}-entry`;
const positionTpId = (id: string) => `pos-${id}-tp`;
const positionSlId = (id: string) => `pos-${id}-sl`;
const orderTriggerId = (id: string) => `ord-${id}-trigger`;

export function drawPositionLines(handle: ChartProviderHandle, position: Position): void {
  const inst = getInstrument(position.instrument);
  const entryColor = position.unrealizedPnl > 0 ? COLORS.bull : COLORS.bear;

  handle.upsertPriceLine({
    id: positionEntryId(position.id),
    price: position.entryPrice,
    color: entryColor,
    lineStyle: "dashed",
    lineWidth: 1,
    title: "",
  });

  // TP/SL line color follows actual P&L at the trigger price, not the chip
  // role. A trailing SL above entry on a long is a profit-lock → green.
  if (position.takeProfit !== undefined) {
    const tpPnl = computePnl(
      inst,
      position.side,
      position.entryPrice,
      position.takeProfit,
      position.size,
    );
    handle.upsertPriceLine({
      id: positionTpId(position.id),
      price: position.takeProfit,
      // Loss-capping TP gets the amber anomaly tint, not bull green.
      color: tpPnl >= 0 ? COLORS.bull : COLORS.tpLoss,
      lineStyle: "dashed",
      lineWidth: 1,
      title: "",
    });
  } else {
    // Idempotent removal — handles the case where the user cleared TP via the
    // position-table cell click. removePriceLine is a no-op if not present.
    handle.removePriceLine(positionTpId(position.id));
  }
  if (position.stopLoss !== undefined) {
    const slPnl = computePnl(
      inst,
      position.side,
      position.entryPrice,
      position.stopLoss,
      position.size,
    );
    handle.upsertPriceLine({
      id: positionSlId(position.id),
      price: position.stopLoss,
      // Trailing SL into profit gets the teal "lock-profit" tint.
      color: slPnl >= 0 ? COLORS.slProfit : COLORS.bear,
      lineStyle: "dashed",
      lineWidth: 1,
      title: "",
    });
  } else {
    handle.removePriceLine(positionSlId(position.id));
  }
}

export function clearPositionLines(handle: ChartProviderHandle, position: Position): void {
  handle.removePriceLine(positionEntryId(position.id));
  handle.removePriceLine(positionTpId(position.id));
  handle.removePriceLine(positionSlId(position.id));
}

export function drawPendingOrderLine(handle: ChartProviderHandle, order: Order): void {
  const trigger = order.type === "limit" ? order.limitPrice : order.stopPrice;
  if (trigger === undefined) return;
  handle.upsertPriceLine({
    id: orderTriggerId(order.id),
    price: trigger,
    color: COLORS.pending,
    lineStyle: "dashed",
    lineWidth: 1,
    title: "",
  });
}

export function clearPendingOrderLine(handle: ChartProviderHandle, order: Order): void {
  handle.removePriceLine(orderTriggerId(order.id));
}
