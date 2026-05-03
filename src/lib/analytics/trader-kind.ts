import type { Trade } from "@/types/trade";

export type TraderKind = "Scalper" | "Day Trader" | "Swing" | "New Trader";

const SCALPER_THRESHOLD_SEC = 60 * 60; // 1 hour
const DAY_TRADER_THRESHOLD_SEC = 24 * 60 * 60; // 1 day

/**
 * Classify the user from their average trade holding time:
 *   < 1h    → Scalper
 *   < 1day  → Day Trader
 *   ≥ 1day  → Swing
 *   0 trades → New Trader (special label, no classification yet)
 *
 * Per Phase 6 D6 thresholds. Pure function over closed trades.
 */
export function classifyTraderKind(trades: Trade[]): TraderKind {
  if (trades.length === 0) return "New Trader";

  const totalDuration = trades.reduce((s, t) => s + t.duration, 0);
  const avg = totalDuration / trades.length;

  if (avg < SCALPER_THRESHOLD_SEC) return "Scalper";
  if (avg < DAY_TRADER_THRESHOLD_SEC) return "Day Trader";
  return "Swing";
}
