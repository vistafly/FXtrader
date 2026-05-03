"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { uiPreCheckBattleRule } from "@/lib/battles/uiGuard";
import { getInstrument } from "@/lib/instruments/instruments";
import { cn } from "@/lib/utils";
import { useOrderStore, type SubmittableOrder } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { OrderSide, OrderType } from "@/types/order";

interface Props {
  symbol: string;
  className?: string;
}

const TYPES: OrderType[] = ["market", "limit", "stop"];
const TYPE_LABEL: Record<OrderType, string> = {
  market: "Market",
  limit: "Limit",
  stop: "Stop",
};

export function QuickBuySellPanel({ symbol, className }: Props) {
  // Raw input string. Parsed at submit time so users can clear & retype.
  const [lotSizeText, setLotSizeText] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const lotSize = (() => {
    const n = Number(lotSizeText);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const session = useSessionStore((s) => s.activeSession);
  const submitOrder = useOrderStore((s) => s.submitOrder);

  const inst = getInstrument(symbol);

  const cycleType = () => {
    setOrderType((t) => TYPES[(TYPES.indexOf(t) + 1) % TYPES.length]);
  };

  const place = async (side: OrderSide) => {
    if (!session) {
      toast.error("Start a session first.");
      return;
    }
    if (lotSize <= 0) {
      toast.error("Enter a lot size > 0.");
      return;
    }
    const price = useReplayStore.getState().engine?.getCurrentPrice();
    if (price == null) {
      toast.error("No current price — engine not loaded.");
      return;
    }

    // Quick-panel orders intentionally start with NO TP/SL set. The user
    // attaches them by dragging the "+ TP" / "+ SL" placeholder chips onto
    // the chart after the position opens.
    const order: SubmittableOrder = {
      sessionId: session.id,
      instrument: symbol,
      side,
      type: orderType,
      size: lotSize,
    };

    if (orderType === "limit") order.limitPrice = price;
    if (orderType === "stop") order.stopPrice = price;

    // UI-side battle pre-check (Phase 7 D1 hybrid). Backstop also runs
    // inside orderStore.submitOrder.
    if (!uiPreCheckBattleRule(order)) return;

    try {
      await submitOrder(order);
    } catch (err) {
      // Backstop fired (this only happens if pre-check missed something).
      toast.error((err as Error).message);
      return;
    }

    if (orderType === "market") {
      toast.success(`${side === "buy" ? "Bought" : "Sold"} ${lotSize} ${symbol} at ${price.toFixed(inst.priceDecimals)}.`);
    } else {
      toast.success(`${TYPE_LABEL[orderType]} ${side} ${lotSize} ${symbol} pending — drag the trigger to adjust.`);
    }
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        onClick={cycleType}
        className="rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        aria-label={`Order type: ${TYPE_LABEL[orderType]}. Click to cycle.`}
      >
        {TYPE_LABEL[orderType]}
      </button>

      <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <span>Size</span>
        <Input
          type="number"
          value={lotSizeText}
          onChange={(e) => setLotSizeText(e.target.value)}
          min={0}
          step="any"
          placeholder="1"
          className="h-8 w-24 font-mono text-sm"
        />
      </label>

      <button
        onClick={() => place("buy")}
        className="!h-9 !w-[73px] rounded-full bg-bull text-bull-foreground text-sm font-semibold transition-opacity hover:opacity-90"
        aria-label={`${TYPE_LABEL[orderType]} buy`}
      >
        Buy
      </button>
      <button
        onClick={() => place("sell")}
        className="!h-9 !w-[73px] rounded-full bg-bear text-bear-foreground text-sm font-semibold transition-opacity hover:opacity-90"
        aria-label={`${TYPE_LABEL[orderType]} sell`}
      >
        Sell
      </button>
    </div>
  );
}
