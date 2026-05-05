"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { computeCommission, computePnl } from "@/lib/engine/MatchingEngine";
import { uiPreCheckBattleRule } from "@/lib/battles/uiGuard";
import { getInstrument } from "@/lib/instruments/instruments";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layoutStore";
import { useOrderStore, type SubmittableOrder } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Instrument } from "@/types/instrument";
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

type Unit = "pips" | "usd" | "pct";
const UNITS: Unit[] = ["pips", "usd", "pct"];
const UNIT_LABEL: Record<Unit, string> = {
  pips: "pips",
  usd: "$",
  pct: "%",
};
/** v2.2.5α: empty placeholders. The unit prefix ($/%) already renders
 *  inside the input as a visual signal of what's being typed; example
 *  digits inside the placeholder were misleading users into thinking
 *  the input had a real value. The cycler button on the right also
 *  labels the unit. */
const UNIT_PLACEHOLDER: Record<Unit, string> = {
  pips: "",
  usd: "",
  pct: "",
};
/**
 * Per-unit step size for the +/- buttons and keyboard arrow-up/down.
 * Tuned for fine-grained control — user can click multiple times for a
 * bigger move; better than coarse jumps that overshoot.
 *   pips  → 1 pip
 *   USD   → $5
 *   pct   → 0.05%
 */
const UNIT_STEP: Record<Unit, number> = {
  pips: 1,
  usd: 5,
  pct: 0.05,
};
/** Decimal precision when applying the step (avoids 0.30000004 artifacts). */
const UNIT_DECIMALS: Record<Unit, number> = {
  pips: 0,
  usd: 0,
  pct: 2,
};
/** Inline prefix shown INSIDE the input on the left. */
const UNIT_PREFIX: Record<Unit, string> = {
  pips: "pips",
  usd: "$",
  pct: "%",
};
/** Per-unit left padding to make room for the prefix without overlapping
 *  the typed number. "pips" needs more room than a single $ or % glyph. */
const UNIT_PL_CLASS: Record<Unit, string> = {
  pips: "pl-10",
  usd: "pl-6",
  pct: "pl-6",
};

function applyStep(text: string, unit: Unit, direction: 1 | -1): string {
  const cur = text === "" ? 0 : Number(text);
  const start = Number.isFinite(cur) && cur > 0 ? cur : 0;
  const next = Math.max(0, start + direction * UNIT_STEP[unit]);
  return next.toFixed(UNIT_DECIMALS[unit]);
}

// Hide native number-input spinner arrows. Tailwind arbitrary selectors
// cover both Firefox (appearance:textfield) and WebKit
// (::-webkit-{outer,inner}-spin-button).
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

/**
 * Convert a user-typed risk (pips / USD / %) into a price delta from pivot.
 *
 * For SL: nets the round-turn commission so "max loss = $X" matches the
 * realized loss on trigger ($500 typed → $500 realized, not $500 + commission).
 * For TP: adds commission so "target profit = $X" hits net of fees too.
 *
 * Returns 0 when the input is invalid or the conversion can't compute
 * (lotSize=0 for USD/% units, balance=0 for %, etc.).
 */
function convertToPriceDelta(
  value: number,
  unit: Unit,
  inst: Instrument,
  lotSize: number,
  balance: number,
  kind: "sl" | "tp",
): number {
  if (value <= 0) return 0;
  if (unit === "pips") return value * inst.pipSize;
  if (lotSize <= 0) return 0;
  // pricePerUnit = USD per unit-of-price-delta per contract; derived by
  // inverting computePnl with delta=1 and size=1.
  const pricePerUnit = computePnl(inst, "buy", 0, 1, 1);
  if (pricePerUnit <= 0) return 0;
  const usdGross = unit === "usd" ? value : (balance * value) / 100;
  const commission = computeCommission(inst, lotSize);
  const usdNet =
    kind === "sl"
      ? Math.max(usdGross - commission, 0) // SL: budget shrinks by commission
      : usdGross + commission; // TP: target grows by commission so net hits goal
  return usdNet / (lotSize * pricePerUnit);
}

/**
 * Inverse of convertToPriceDelta — given a price-delta, derive what value
 * the user would type in the target unit to produce the same delta.
 *
 * Used when cycling units (pips → $ → %) so the input value transforms with
 * the unit selection — the SL/TP price stays put, only the displayed unit
 * changes. e.g. typing "20" in pips, cycling to "$" should swap the input
 * to the USD equivalent (≈ $200 for 1-lot EURUSD).
 */
function priceDeltaToUnit(
  delta: number,
  unit: Unit,
  inst: Instrument,
  lotSize: number,
  balance: number,
  kind: "sl" | "tp",
): number {
  if (delta <= 0) return 0;
  if (unit === "pips") return delta / inst.pipSize;
  if (lotSize <= 0) return 0;
  const pricePerUnit = computePnl(inst, "buy", 0, 1, 1);
  if (pricePerUnit <= 0) return 0;
  const usdNet = delta * lotSize * pricePerUnit;
  // Reverse the commission netting from convertToPriceDelta.
  const commission = computeCommission(inst, lotSize);
  const usdGross = kind === "sl" ? usdNet + commission : usdNet - commission;
  if (unit === "usd") return Math.max(usdGross, 0);
  // pct of balance
  if (balance <= 0) return 0;
  return Math.max((usdGross / balance) * 100, 0);
}

export function QuickBuySellPanel({ symbol, className }: Props) {
  const [lotSizeText, setLotSizeText] = useState("1");
  const [orderType, setOrderType] = useState<OrderType>("market");
  const [slText, setSlText] = useState("");
  const [slUnit, setSlUnit] = useState<Unit>("pips");
  const [tpText, setTpText] = useState("");
  const [tpUnit, setTpUnit] = useState<Unit>("pips");
  // v2.2.5α: trigger price for limit/stop orders. Empty by default;
  // initialized to current market on type-change so the preview line and
  // SL/TP previews orient around a sensible default the user can edit.
  const [triggerText, setTriggerText] = useState("");

  const lotSize = (() => {
    const n = Number(lotSizeText);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const slValue = (() => {
    if (slText === "") return 0;
    const n = Number(slText);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const tpValue = (() => {
    if (tpText === "") return 0;
    const n = Number(tpText);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const session = useSessionStore((s) => s.activeSession);
  const battle = useSessionStore((s) => s.activeBattle);
  const balance = useSessionStore((s) => s.balance);
  const submitOrder = useOrderStore((s) => s.submitOrder);
  const setSlPreview = useLayoutStore((s) => s.setSlPreview);
  // Drag-overridden trigger price + setter. PositionDragOverlay writes
  // here when the user drags the preview line on the chart.
  const previewTriggerOverride = useLayoutStore(
    (s) => s.previewTriggerOverride,
  );
  const setPreviewTriggerOverride = useLayoutStore(
    (s) => s.setPreviewTriggerOverride,
  );

  const inst = getInstrument(symbol);
  const slRequired = !!battle?.rules?.requireStopLoss;

  // Sync the input's text with drag overrides via vanilla Zustand
  // subscription (not the React hook) so React's set-state-in-effect rule
  // doesn't trip — setState calls happen outside React's render cycle.
  // Same subscription handles the X-button clear — bumping
  // clearPreviewEpoch wipes the local input state so the preview vanishes.
  useEffect(() => {
    const unsub = useLayoutStore.subscribe((state, prev) => {
      // Drag override → mirror into trigger input
      const cur = state.previewTriggerOverride;
      const old = prev.previewTriggerOverride;
      if (
        cur !== old &&
        cur &&
        cur.symbol === symbol &&
        cur.price > 0 &&
        cur.price !== old?.price
      ) {
        setTriggerText(cur.price.toFixed(inst.priceDecimals));
      }
      // X-button click → clear all panel inputs
      if (state.clearPreviewEpoch !== prev.clearPreviewEpoch) {
        setTriggerText("");
        setSlText("");
        setTpText("");
      }
    });
    return () => unsub();
  }, [symbol, inst.priceDecimals]);

  const cycleType = () => {
    setOrderType((t) => {
      const next = TYPES[(TYPES.indexOf(t) + 1) % TYPES.length];
      // Reset any prior drag override on type change.
      setPreviewTriggerOverride(null);
      if (next !== "market") {
        const mkt =
          useReplayStore.getState().getEngine(symbol)?.getCurrentPrice() ?? 0;
        if (mkt > 0) {
          setTriggerText(mkt.toFixed(inst.priceDecimals));
        }
      } else {
        setTriggerText("");
      }
      return next;
    });
  };
  // Cycling the unit recomputes the displayed value in the new unit so the
  // SL/TP price-delta stays put — e.g. "20" in pips becomes "$200" in USD
  // (for a 1-lot EURUSD trade), not "20" reinterpreted as $20. Empty input
  // just swaps the unit; no number conversion needed.
  const cycleUnit = (which: "sl" | "tp") => {
    if (which === "sl") {
      const nextUnit = UNITS[(UNITS.indexOf(slUnit) + 1) % UNITS.length];
      const delta = convertToPriceDelta(slValue, slUnit, inst, lotSize, balance, "sl");
      if (delta > 0) {
        const newVal = priceDeltaToUnit(delta, nextUnit, inst, lotSize, balance, "sl");
        if (newVal > 0) setSlText(newVal.toFixed(UNIT_DECIMALS[nextUnit]));
      }
      setSlUnit(nextUnit);
    } else {
      const nextUnit = UNITS[(UNITS.indexOf(tpUnit) + 1) % UNITS.length];
      const delta = convertToPriceDelta(tpValue, tpUnit, inst, lotSize, balance, "tp");
      if (delta > 0) {
        const newVal = priceDeltaToUnit(delta, nextUnit, inst, lotSize, balance, "tp");
        if (newVal > 0) setTpText(newVal.toFixed(UNIT_DECIMALS[nextUnit]));
      }
      setTpUnit(nextUnit);
    }
  };

  const slDelta = convertToPriceDelta(slValue, slUnit, inst, lotSize, balance, "sl");
  const tpDelta = convertToPriceDelta(tpValue, tpUnit, inst, lotSize, balance, "tp");
  // Tied to slDelta (not slValue) so an SL with a too-small USD/% value
  // (commission would zero it) keeps the buttons disabled instead of
  // letting the order through with an undefined stopLoss.
  const slMissing = slRequired && slDelta <= 0;

  // v2.2.5α: minimum SL/TP distance to prevent immediate triggers. For
  // market orders, the floor is the current bar's adverse extreme (close
  // to low for buys, close to high for sells) so a freshly-placed
  // position can't be tripped by the bar that's still in view. For
  // limit/stop, fall back to 2 pips. Either way the SL/TP must be
  // meaningfully outside the current price action.
  //
  // The 2-pip floor catches the user's exact scenario: $20 SL on a
  // 100-lot trade resolves to delta ≈ 0.02 pips → blocked.
  const minMeaningfulDelta = (() => {
    const baseFloor = inst.pipSize * 2;
    if (orderType !== "market") return baseFloor;
    const engine = useReplayStore.getState().getEngine(symbol);
    const bar = engine?.getCurrentBar();
    if (!bar) return baseFloor;
    const buyAdverse = Math.max(0, bar.close - bar.low);
    const sellAdverse = Math.max(0, bar.high - bar.close);
    return Math.max(baseFloor, buyAdverse, sellAdverse);
  })();
  const slTooTight = slDelta > 0 && slDelta < minMeaningfulDelta;
  const tpTooTight = tpDelta > 0 && tpDelta < minMeaningfulDelta;

  /**
   * v2.2.5α: helper that runs after every user-driven edit to lot size,
   * SL, or TP. If we're in limit/stop mode AND triggerText is currently
   * empty (because the user just placed an order, which clears it), we
   * auto-fill the trigger with the current market price so the staging
   * preview reappears. Internal `setX` calls during submit don't go
   * through input onChange events, so they don't trigger this — only
   * actual user typing does.
   */
  const restageIfEmpty = () => {
    if (orderType === "market") return;
    if (triggerText !== "") return;
    const mkt =
      useReplayStore.getState().getEngine(symbol)?.getCurrentPrice() ?? 0;
    if (mkt > 0) setTriggerText(mkt.toFixed(inst.priceDecimals));
  };
  const onLotSizeChange = (v: string) => {
    setLotSizeText(v);
    restageIfEmpty();
  };
  const onSlChange = (v: string) => {
    setSlText(v);
    restageIfEmpty();
  };
  const onTpChange = (v: string) => {
    setTpText(v);
    restageIfEmpty();
  };

  // Pivot for SL/TP placement + chart preview lines.
  //   market → current market price (engine current)
  //   limit/stop → user's trigger price (parsed from triggerText)
  // Without this, limit/stop orders' SL/TP previews would still orient
  // around market — misleading the user about where the trade will sit.
  const triggerPrice = (() => {
    const n = Number(triggerText);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();
  const pivot = (() => {
    if (orderType !== "market") {
      // Drag override beats the input — chart-side drags update this
      // synchronously on every pointermove, so the SL/TP preview lines
      // and the trigger chip move together. Without this, the SL/TP
      // would lag behind by a React render cycle while triggerText
      // caught up via the vanilla subscribe handler.
      if (
        previewTriggerOverride &&
        previewTriggerOverride.symbol === symbol &&
        previewTriggerOverride.price > 0
      ) {
        return previewTriggerOverride.price;
      }
      if (triggerPrice > 0) return triggerPrice;
    }
    const engine = useReplayStore.getState().getEngine(symbol);
    return engine?.getCurrentPrice() ?? 0;
  })();

  // Push SL/TP/trigger preview lines to layoutStore. ChartContainer
  // subscribes and draws lines on the matching pane. Cleared on unmount
  // or when there's nothing meaningful to show.
  //
  // Show condition:
  //   - market orders: only when SL or TP is typed
  //   - limit/stop orders: as soon as a trigger price exists (since the
  //     trigger line itself is useful preview), even if SL/TP are empty
  const isLimitOrStop = orderType !== "market" && triggerPrice > 0;
  useEffect(() => {
    const hasSlTp = slDelta > 0 || tpDelta > 0;
    if ((!hasSlTp && !isLimitOrStop) || pivot <= 0 || !symbol) {
      setSlPreview(null);
      return;
    }
    setSlPreview({
      symbol,
      // Only emit SL prices when the user typed an SL value. Without
      // this, the chart would render BUY SL / SELL SL lines AT the pivot
      // (redundant) when no SL was set — making it look like a second
      // pending order was being staged.
      longPrice: slDelta > 0 ? pivot - slDelta : undefined,
      shortPrice: slDelta > 0 ? pivot + slDelta : undefined,
      tpLongPrice: tpDelta > 0 ? pivot + tpDelta : undefined,
      tpShortPrice: tpDelta > 0 ? pivot - tpDelta : undefined,
      triggerPrice: isLimitOrStop ? pivot : undefined,
      triggerKind: isLimitOrStop ? (orderType as "limit" | "stop") : undefined,
    });
    return () => setSlPreview(null);
  }, [slDelta, tpDelta, pivot, symbol, setSlPreview, isLimitOrStop, orderType]);

  const place = async (side: OrderSide) => {
    if (!session) {
      toast.error("Start a session first.");
      return;
    }
    if (lotSize <= 0) {
      toast.error("Enter a lot size > 0.");
      return;
    }
    const price = useReplayStore.getState().getEngine(symbol)?.getCurrentPrice();
    if (price == null) {
      toast.error("No current price — engine not loaded.");
      return;
    }

    const order: SubmittableOrder = {
      sessionId: session.id,
      instrument: symbol,
      side,
      type: orderType,
      size: lotSize,
    };

    // v2.2.5α: use the user's typed trigger price for limit/stop orders;
    // fall back to current market only if the field is empty/invalid.
    const trigger = triggerPrice > 0 ? triggerPrice : price;
    if (orderType === "limit") order.limitPrice = trigger;
    if (orderType === "stop") order.stopPrice = trigger;

    const orderPivot = orderType === "market" ? price : trigger;

    if (slDelta > 0) {
      order.stopLoss =
        side === "buy" ? orderPivot - slDelta : orderPivot + slDelta;
    }
    if (tpDelta > 0) {
      order.takeProfit =
        side === "buy" ? orderPivot + tpDelta : orderPivot - tpDelta;
    }

    if (!uiPreCheckBattleRule(order)) return;

    try {
      await submitOrder(order);
    } catch (err) {
      toast.error((err as Error).message);
      return;
    }

    // v2.2.5α: clear all inputs after submit. Triggers/SL/TP previews
    // immediately vanish from the chart so the just-placed pending
    // order's lines aren't visually doubled by the preview.
    //
    // For limit/stop, the trigger input stays visible (orderType is still
    // Limit/Stop) — the user types or drags a price into it to stage the
    // next order. They no longer have to re-cycle the order type, but
    // also no longer get an automatic preview popping up the moment a
    // submit lands.
    setSlText("");
    setTpText("");
    setTriggerText("");
    setPreviewTriggerOverride(null);

    if (orderType === "market") {
      toast.success(
        `${side === "buy" ? "Bought" : "Sold"} ${lotSize} ${symbol} at ${price.toFixed(inst.priceDecimals)}.`,
      );
    } else {
      toast.success(
        `${TYPE_LABEL[orderType]} ${side} ${lotSize} ${symbol} pending — drag the trigger to adjust.`,
      );
    }
  };

  const renderPriceField = (
    kind: "sl" | "tp",
    text: string,
    setText: (v: string) => void,
    unit: Unit,
    isMissing: boolean,
    requiredBadge: boolean,
  ) => (
    <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
      <span className="flex items-center gap-1">
        {kind === "sl" ? "SL" : "TP"}
        {requiredBadge && (
          <span
            className="font-mono text-[10px] font-semibold text-bear"
            aria-label="required"
            title="Required by battle rules"
          >
            *
          </span>
        )}
      </span>
      <div className="flex items-center gap-1">
        <div className="relative">
          {UNIT_PREFIX[unit] && (
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {UNIT_PREFIX[unit]}
            </span>
          )}
          <Input
            type="number"
            value={text}
            onChange={(e) => setText(e.target.value)}
            min={0}
            step={UNIT_STEP[unit]}
            placeholder={UNIT_PLACEHOLDER[unit]}
            className={cn(
              "h-8 w-24 font-mono text-sm",
              NO_SPINNER,
              UNIT_PL_CLASS[unit],
              isMissing && "border-bear/60 focus-visible:ring-bear/40",
            )}
          />
        </div>
        {/* Custom step buttons. Native spinner arrows are hidden via
            NO_SPINNER so they don't crowd the layout and don't ignore the
            unit-aware step. These add `UNIT_STEP[unit]` per click; on an
            empty input the first click starts from 0 + step (so an empty
            USD input plus a click → "50", an empty pips input → "1"). */}
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => setText(applyStep(text, unit, 1))}
            aria-label={`Increase ${kind.toUpperCase()}`}
            tabIndex={-1}
            className="h-4 rounded-t border border-b-0 border-border bg-background px-1.5 font-mono text-[8px] leading-none text-muted-foreground transition-colors hover:text-foreground"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => setText(applyStep(text, unit, -1))}
            aria-label={`Decrease ${kind.toUpperCase()}`}
            tabIndex={-1}
            className="h-4 rounded-b border border-border bg-background px-1.5 font-mono text-[8px] leading-none text-muted-foreground transition-colors hover:text-foreground"
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          onClick={() => cycleUnit(kind)}
          title={`Cycle ${kind.toUpperCase()} unit (pips → $ → %)`}
          aria-label={`${kind.toUpperCase()} unit: ${UNIT_LABEL[unit]}. Click to cycle.`}
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          {UNIT_LABEL[unit]}
        </button>
      </div>
    </label>
  );

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
          onChange={(e) => onLotSizeChange(e.target.value)}
          min={0}
          step="any"
          placeholder="1"
          className="h-8 w-24 font-mono text-sm"
        />
      </label>

      {/* Trigger price input — only shown for limit/stop. The dotted gray
          preview line on the chart updates live as the user edits this
          value, and SL/TP previews orient around it. */}
      {orderType !== "market" && (
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>{TYPE_LABEL[orderType]}</span>
          <Input
            type="number"
            value={triggerText}
            onChange={(e) => setTriggerText(e.target.value)}
            min={0}
            step="any"
            placeholder="price"
            className={cn("h-8 w-28 font-mono text-sm", NO_SPINNER)}
          />
        </label>
      )}

      {renderPriceField("sl", slText, onSlChange, slUnit, slMissing || slTooTight, slRequired)}
      {renderPriceField("tp", tpText, onTpChange, tpUnit, tpTooTight, false)}

      {(() => {
        const cantSubmit = slMissing || slTooTight || tpTooTight || lotSize <= 0;
        const reason = slMissing
          ? "Stop loss required by battle rules"
          : slTooTight
            ? "Stop loss is too tight — would trigger immediately. Increase the value."
            : tpTooTight
              ? "Take profit is too tight — would trigger immediately. Increase the value."
              : lotSize <= 0
                ? "Enter a lot size"
                : undefined;
        return (
          <>
            <button
              onClick={() => place("buy")}
              disabled={cantSubmit}
              title={reason}
              className="!h-9 !w-[73px] rounded-full bg-bull text-bull-foreground text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`${TYPE_LABEL[orderType]} buy`}
            >
              Buy
            </button>
            <button
              onClick={() => place("sell")}
              disabled={cantSubmit}
              title={reason}
              className="!h-9 !w-[73px] rounded-full bg-bear text-bear-foreground text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`${TYPE_LABEL[orderType]} sell`}
            >
              Sell
            </button>
          </>
        );
      })()}
    </div>
  );
}
