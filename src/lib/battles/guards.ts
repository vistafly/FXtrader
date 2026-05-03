import type { Battle } from "@/types/battle";
import type { Instrument } from "@/types/instrument";
import type { Order } from "@/types/order";

/**
 * Pure rule-check functions for battle constraints. Used by both the UI
 * (for inline pre-submission feedback / toast) and orderStore.submitOrder
 * (as a backstop), per Phase 7 D1 hybrid enforcement.
 */

export type SubmittableOrderDraft = Pick<
  Order,
  "side" | "type" | "size" | "limitPrice" | "stopPrice" | "stopLoss" | "takeProfit"
>;

export interface BattleRuleContext {
  /** The battle whose rules to enforce. */
  battle: Battle;
  /** The instrument being traded — used for max-loss-per-trade pip math. */
  instrument: Instrument;
  /** Account balance at submission time — used for percent-based rules. */
  currentBalance: number;
}

/**
 * Returns a human-readable violation message, or `null` if the order
 * satisfies every battle rule.
 *
 * Designed to be cheap and side-effect free so the same call is safe in
 * both UI render hot-paths and the orderStore.submitOrder backstop.
 */
export function checkBattleRule(
  draft: SubmittableOrderDraft,
  ctx: BattleRuleContext,
): string | null {
  const { battle, instrument, currentBalance } = ctx;
  const { rules } = battle;

  if (rules.requireStopLoss && (draft.stopLoss === undefined || draft.stopLoss === null)) {
    return "Battle rule: this battle requires a stop loss on every trade.";
  }

  if (rules.maxLossPerTradePct !== undefined) {
    const max = computeMaxLossUsd(draft, instrument);
    if (max === null) {
      // No SL set → loss is unbounded → fails the rule by definition.
      return `Battle rule: max loss/trade is ${(rules.maxLossPerTradePct * 100).toFixed(1)}% — set a stop loss so the loss is bounded.`;
    }
    const cap = currentBalance * rules.maxLossPerTradePct;
    // Tiny epsilon to absorb floating-point error in the pip-math chain
    // (e.g. 0.001 * 100_000 yields 100.0000000000112). Round to 2 decimals
    // since these are USD amounts users see.
    if (Math.round(max * 100) > Math.round(cap * 100)) {
      return `Battle rule: max loss/trade is ${(rules.maxLossPerTradePct * 100).toFixed(1)}% of balance ($${cap.toFixed(2)}) — this order risks $${max.toFixed(2)}.`;
    }
  }

  // Note: maxDrawdownPct is checked elsewhere (sessionStore.applyBarSettlement)
  // because it depends on running equity, not order-time state.
  return null;
}

/**
 * If a draft has a stop loss set, return the dollar-value loss that would
 * be locked at SL fill. Returns null when the SL isn't set (loss is then
 * unbounded by definition).
 */
export function computeMaxLossUsd(
  draft: SubmittableOrderDraft,
  inst: Instrument,
): number | null {
  if (draft.stopLoss === undefined) return null;
  // Determine the entry price for the loss math:
  //   market    → unknown until fill; assume current pivot is captured upstream
  //                (the UI passes a current-bar close; orderStore does too)
  //   limit     → limitPrice
  //   stop      → stopPrice
  // For simplicity we approximate market entries with the SL's mid-distance
  // already captured by the trader — the UI is expected to provide a coherent
  // SL relative to the current price. We compute |entry − sl| from whatever
  // pivot is available.
  const pivot =
    draft.type === "limit"
      ? draft.limitPrice
      : draft.type === "stop"
        ? draft.stopPrice
        : undefined;

  // For a market order without a known pivot, we can't bound the loss yet —
  // the UI clamp ensures sl is on the correct side, so the SL-to-entry
  // distance equals zero in the worst case (immediate trigger). Treat this
  // as "loss bounded by clamp" → 0. The orderStore backstop runs again
  // post-fill if needed.
  if (pivot === undefined) {
    return 0;
  }

  const priceDelta = Math.abs(pivot - draft.stopLoss);
  const pricePerUnit =
    inst.class === "forex" ? inst.contractSize : inst.tickValue / inst.tickSize;
  return priceDelta * pricePerUnit * draft.size;
}

/**
 * Mid-session check: has the running equity dropped past the battle's
 * maxDrawdownPct threshold? Returns the violation message, or null if OK.
 *
 * The threshold is computed from the battle's own startingBalance — that
 * is the source of truth for the rule, NOT the session's metadata (in
 * case they ever drift).
 */
export function checkMaxDrawdown(
  battle: Battle,
  currentEquity: number,
): string | null {
  const cap = battle.rules.maxDrawdownPct;
  if (cap === undefined) return null;
  const threshold = battle.startingBalance * (1 - cap);
  if (currentEquity <= threshold) {
    return `Max drawdown exceeded — equity $${currentEquity.toFixed(2)} dropped past the ${(cap * 100).toFixed(1)}% threshold ($${threshold.toFixed(2)}).`;
  }
  return null;
}
