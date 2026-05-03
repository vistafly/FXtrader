import { create } from "zustand";

import {
  computeCommission,
  computePnl,
  type ProcessBarResult,
} from "@/lib/engine/MatchingEngine";
import { useReplayStore } from "@/stores/replayStore";
import type { Bar } from "@/types/bar";
import type { Instrument } from "@/types/instrument";
import type { Order, OrderSide } from "@/types/order";
import type { Position } from "@/types/position";
import type { Trade } from "@/types/trade";

/** Position with an internal "user clicked close, fill on next bar" flag. */
export interface OpenPosition extends Position {
  _pendingClose?: boolean;
}

export type SubmittableOrder = Omit<
  Order,
  "id" | "status" | "createdAt"
>;

export type PositionAdjustments = { tp?: number; sl?: number };

let _orderCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(++_orderCounter).toString(36)}`;

export interface OrderState {
  pendingOrders: Order[];
  openPositions: OpenPosition[];
  closedTrades: Trade[];

  submitOrder: (order: SubmittableOrder) => Promise<Order>;
  cancelOrder: (id: string) => Promise<void>;
  /** Adjust a pending limit/stop order's trigger price (drag-to-modify on the chart). */
  modifyOrder: (id: string, changes: { limitPrice?: number; stopPrice?: number }) => Promise<void>;
  modifyPosition: (id: string, changes: PositionAdjustments) => Promise<void>;
  /** Mark a position for close-on-next-bar. Actual closure happens in applyBarResult. */
  closePosition: (id: string) => Promise<void>;

  /**
   * Engine seam (per CLAUDE.md §9 + Phase 5 D1). Called from providers.tsx
   * once per bar with the matching engine's output. Applies fills, closures,
   * processes manual-close requests at bar.open, and recomputes unrealizedPnl.
   *
   * Returns the closures applied so the caller (sessionStore) can settle
   * realized P&L into the balance.
   */
  applyBarResult: (
    engineResult: ProcessBarResult,
    bar: Bar,
    instrument: Instrument,
  ) => { closuresApplied: { realizedPnl: number; trade: Trade }[] };

  /** Wipe per-session state. Used when starting/loading a session. */
  resetForSession: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  pendingOrders: [],
  openPositions: [],
  closedTrades: [],

  submitOrder: async (input) => {
    // Clamp TP/SL to the correct side of the price the order will fill at,
    // so an auto-fire on the next bar is impossible. The "pivot price" is
    // whatever price the order will fill at (current market for market
    // orders, the trigger price for limit/stop). Clamps mirror the drag
    // rules in PositionDragOverlay:
    //   long  SL ≤ pivot,  long  TP ≥ pivot
    //   short SL ≥ pivot,  short TP ≤ pivot
    let pivotPrice: number | undefined;
    if (input.type === "market") {
      pivotPrice = useReplayStore.getState().engine?.getCurrentBar()?.close;
    } else if (input.type === "limit") {
      pivotPrice = input.limitPrice;
    } else {
      pivotPrice = input.stopPrice;
    }
    if (pivotPrice != null) {
      if (input.stopLoss != null) {
        input = {
          ...input,
          stopLoss:
            input.side === "buy"
              ? Math.min(input.stopLoss, pivotPrice)
              : Math.max(input.stopLoss, pivotPrice),
        };
      }
      if (input.takeProfit != null) {
        input = {
          ...input,
          takeProfit:
            input.side === "buy"
              ? Math.max(input.takeProfit, pivotPrice)
              : Math.min(input.takeProfit, pivotPrice),
        };
      }
    }

    // UX deviation from spec §6: market orders fill IMMEDIATELY at the
    // current bar's close price, not on next-bar-open. Users expect the
    // position to appear the moment they click Buy/Sell. Limit and stop
    // orders still go through the matching engine on the next bar event.
    if (input.type === "market") {
      const engine = useReplayStore.getState().engine;
      const currentBar = engine?.getCurrentBar();
      if (!currentBar) {
        throw new Error("Cannot place market order: engine has no current bar.");
      }
      const fillPrice = currentBar.close;
      const position: Position = {
        id: nextId("pos"),
        sessionId: input.sessionId,
        instrument: input.instrument,
        side: input.side,
        size: input.size,
        entryPrice: fillPrice,
        entryTime: currentBar.time,
        takeProfit: input.takeProfit,
        stopLoss: input.stopLoss,
        unrealizedPnl: 0,
        realizedPnl: 0,
        commission: 0,
        status: "open",
      };
      set((state) => ({
        openPositions: [...state.openPositions, position],
      }));
      return {
        ...input,
        id: nextId("ord"),
        status: "filled",
        createdAt: currentBar.time,
        filledAt: currentBar.time,
        filledPrice: fillPrice,
      };
    }

    // Use the engine's current bar time as the simulated submission time.
    // This keeps `createdAt` on the same clock as bar.time so the
    // matching-engine temporal guard (`createdAt > bar.time`) interprets
    // correctly during scrub-back / replay-through-seen-bars.
    const simNow =
      useReplayStore.getState().engine?.getCurrentBar()?.time ??
      Math.floor(Date.now() / 1000);
    const order: Order = {
      ...input,
      id: nextId("ord"),
      status: "pending",
      createdAt: simNow,
    };
    set((state) => ({ pendingOrders: [...state.pendingOrders, order] }));
    return order;
  },

  cancelOrder: async (id) => {
    set((state) => ({
      pendingOrders: state.pendingOrders.filter((o) => o.id !== id),
    }));
  },

  modifyOrder: async (id, changes) => {
    set((state) => ({
      pendingOrders: state.pendingOrders.map((o) =>
        o.id === id
          ? {
              ...o,
              limitPrice: "limitPrice" in changes ? changes.limitPrice : o.limitPrice,
              stopPrice: "stopPrice" in changes ? changes.stopPrice : o.stopPrice,
            }
          : o,
      ),
    }));
  },

  modifyPosition: async (id, changes) => {
    set((state) => ({
      openPositions: state.openPositions.map((p) =>
        p.id === id
          ? {
              ...p,
              takeProfit: "tp" in changes ? changes.tp : p.takeProfit,
              stopLoss: "sl" in changes ? changes.sl : p.stopLoss,
            }
          : p,
      ),
    }));
  },

  closePosition: async (id) => {
    // Immediate close at the current bar's close price — same UX deviation
    // as the immediate-fill on submitOrder. Spec §6 says manual close fills
    // at next-bar open, but users expect the trade to disappear the moment
    // they click X.
    const pos = useOrderStore.getState().openPositions.find((p) => p.id === id);
    if (!pos) return;

    const engine = useReplayStore.getState().engine;
    const currentBar = engine?.getCurrentBar();
    if (!currentBar) return;

    // Resolve the instrument lazily here to keep the store free of a
    // hard-coded instrument list.
    const { getInstrument } = await import("@/lib/instruments/instruments");
    const inst = getInstrument(pos.instrument);

    const closePrice = currentBar.close;
    const grossPnl = computePnl(inst, pos.side, pos.entryPrice, closePrice, pos.size);
    const commission = computeCommission(inst, pos.size);
    const realizedPnl = grossPnl - commission;
    const pips =
      ((closePrice - pos.entryPrice) / inst.pipSize) *
      (pos.side === "buy" ? 1 : -1);

    const trade: Trade = {
      id: nextId("trd"),
      sessionId: pos.sessionId,
      instrument: pos.instrument,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      entryTime: pos.entryTime,
      exitPrice: closePrice,
      exitTime: currentBar.time,
      pnl: realizedPnl,
      pips,
      commission,
      duration: currentBar.time - pos.entryTime,
      closeReason: "manual",
    };

    set((state) => ({
      openPositions: state.openPositions.filter((p) => p.id !== id),
      closedTrades: [...state.closedTrades, trade],
    }));

    // Settle the realized P&L into the session balance. Lazy import to
    // avoid a circular dependency at module-load time.
    const { useSessionStore } = await import("@/stores/sessionStore");
    useSessionStore.getState().applyBarSettlement({
      closures: [{ realizedPnl, trade }],
      openPositions: useOrderStore.getState().openPositions,
      instrument: inst,
      currentPrice: closePrice,
      currentBarTime: currentBar.time,
    });
  },

  applyBarResult: (engineResult, bar, instrument) => {
    const closuresApplied: { realizedPnl: number; trade: Trade }[] = [];

    set((state) => {
      // 1. Apply fills: remove pending orders, push new positions.
      const filledOrderIds = new Set(engineResult.fills.map((f) => f.orderId));
      let pendingOrders = state.pendingOrders.filter(
        (o) => !filledOrderIds.has(o.id),
      );
      let openPositions: OpenPosition[] = [
        ...state.openPositions,
        ...engineResult.fills.map((f) => f.position),
      ];

      // 2. Apply rejections: drop rejected orders too.
      const rejectedIds = new Set(
        engineResult.rejections.map((r) => r.orderId),
      );
      pendingOrders = pendingOrders.filter((o) => !rejectedIds.has(o.id));

      // 3. Apply engine closures (TP/SL/liquidation).
      const closedPositionIds = new Set(
        engineResult.closures.map((c) => c.positionId),
      );
      const newTrades: Trade[] = [];
      for (const c of engineResult.closures) {
        newTrades.push(c.trade);
        closuresApplied.push({ realizedPnl: c.realizedPnl, trade: c.trade });
      }
      openPositions = openPositions.filter(
        (p) => !closedPositionIds.has(p.id),
      );

      // 4. Manual-close pass: any position still flagged _pendingClose closes
      //    now at bar.open per spec §6 ("market order fills at next-bar open").
      //    Fills against the matching engine already happened above; this is
      //    purely UI-initiated closure and matches the bar.open price rule.
      const stillOpen: OpenPosition[] = [];
      for (const p of openPositions) {
        if (p._pendingClose) {
          const grossPnl = computePnl(
            instrument,
            p.side,
            p.entryPrice,
            bar.open,
            p.size,
          );
          const commission = computeCommission(instrument, p.size);
          const realizedPnl = grossPnl - commission;
          const trade: Trade = {
            id: nextId("trd"),
            sessionId: p.sessionId,
            instrument: p.instrument,
            side: p.side,
            size: p.size,
            entryPrice: p.entryPrice,
            entryTime: p.entryTime,
            exitPrice: bar.open,
            exitTime: bar.time,
            pnl: realizedPnl,
            pips: ((bar.open - p.entryPrice) / instrument.pipSize) *
              (p.side === "buy" ? 1 : -1),
            commission,
            duration: bar.time - p.entryTime,
            closeReason: "manual",
          };
          newTrades.push(trade);
          closuresApplied.push({ realizedPnl, trade });
        } else {
          stillOpen.push(p);
        }
      }

      // 5. Recompute unrealizedPnl on remaining openPositions vs bar.close.
      //    Skip positions whose entry is in the future relative to this bar
      //    (replay-through-seen-bars after a scrub-back); those keep their
      //    previously-stored unrealized so the chip label doesn't show a
      //    P&L from a time when the position didn't exist.
      const reMarked: OpenPosition[] = stillOpen.map((p) => {
        if (p.entryTime > bar.time) return p;
        return {
          ...p,
          unrealizedPnl: computePnl(
            instrument,
            p.side,
            p.entryPrice,
            bar.close,
            p.size,
          ),
        };
      });

      return {
        pendingOrders,
        openPositions: reMarked,
        closedTrades: [...state.closedTrades, ...newTrades],
      };
    });

    return { closuresApplied };
  },

  resetForSession: () => {
    set({ pendingOrders: [], openPositions: [], closedTrades: [] });
  },
}));

/**
 * Helper for sides — useful when the close-position UI submits a counter-side market.
 * Exported so other modules don't redefine it.
 */
export const oppositeSide = (s: OrderSide): OrderSide => (s === "buy" ? "sell" : "buy");
