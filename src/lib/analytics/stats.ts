import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

/**
 * Pure analytics functions over a session+trade history. Used by the
 * dashboard's stats grid and by the journal (Phase 7).
 *
 * Defensive contract: NEVER return NaN, Infinity, or undefined-pretending-
 * to-be-a-number. Functions return null when a metric is mathematically
 * undefined (e.g. win rate over zero trades). The UI renders null as "—".
 */

export interface OverviewStats {
  /** Total closed trades. */
  trades: number;
  /** Total winning trades (pnl > 0). */
  wins: number;
  /** Total losing trades (pnl < 0). pnl === 0 counts as neither. */
  losses: number;
  /** Wins / (wins + losses), as a fraction in [0,1]. null when wins+losses=0. */
  winRate: number | null;
  /** Mean P&L per closed trade. null when trades=0. */
  expectancy: number | null;
  /** Largest peak-to-trough drawdown across the equity curve, as a positive
   *  USD figure. null when there are no trades. */
  maxDrawdown: number | null;
  /** Largest single-session %P&L (e.g. +0.0405 = +4.05%). null when no trades. */
  maxPnlPct: number | null;
  /** Largest single-session $ P&L. null when no trades. */
  maxPnl: number | null;
  /** Total session-time played, in seconds (sum of session.lastPlayedAt
   *  minus session.startBarTime, but better measured as wall-clock time
   *  played — we use sum of trade durations as a proxy since we don't
   *  separately track active session time). null when no trades. */
  timePlayedSeconds: number | null;
}

export interface SessionPnl {
  sessionId: string;
  pnl: number;       // realized P&L for the session
  pnlPct: number;    // pnl / startingBalance
}

/**
 * Compute the standard dashboard stats. Both lists may be empty — the
 * function still returns a populated object with `null`s where appropriate.
 */
export function computeOverview(
  sessions: Session[],
  trades: Trade[],
): OverviewStats {
  const totalTrades = trades.length;

  // Win/loss split. Treats pnl === 0 as neither (rare, but happens on
  // synthetic instruments with zero spread).
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    if (t.pnl > 0) wins++;
    else if (t.pnl < 0) losses++;
  }
  const decided = wins + losses;

  // Aggregate trade-level metrics.
  const sumPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const sumDuration = trades.reduce((s, t) => s + t.duration, 0);

  const expectancy = totalTrades === 0 ? null : sumPnl / totalTrades;
  const winRate = decided === 0 ? null : wins / decided;

  // Per-session P&L for max-P&L computation.
  const perSession = computePerSessionPnl(sessions, trades);
  const maxBySession = perSession.reduce<{ pnl: number; pct: number } | null>(
    (best, s) => {
      if (!best || s.pnl > best.pnl) return { pnl: s.pnl, pct: s.pnlPct };
      return best;
    },
    null,
  );

  // Max drawdown over the chronological trade equity curve.
  const drawdown = computeMaxDrawdown(trades);

  return {
    trades: totalTrades,
    wins,
    losses,
    winRate,
    expectancy,
    maxDrawdown: drawdown,
    maxPnlPct: maxBySession?.pct ?? null,
    maxPnl: maxBySession?.pnl ?? null,
    timePlayedSeconds: totalTrades === 0 ? null : sumDuration,
  };
}

/**
 * Per-session realized P&L from a list of closed trades. Sessions with zero
 * trades still appear (with pnl=0) so the UI can show them.
 */
export function computePerSessionPnl(
  sessions: Session[],
  trades: Trade[],
): SessionPnl[] {
  const byId = new Map<string, { pnl: number; starting: number }>();
  for (const s of sessions) {
    byId.set(s.id, { pnl: 0, starting: s.startingBalance });
  }
  for (const t of trades) {
    const entry = byId.get(t.sessionId);
    if (!entry) continue; // trade for a deleted session — ignore
    entry.pnl += t.pnl;
  }
  return Array.from(byId.entries()).map(([sessionId, { pnl, starting }]) => ({
    sessionId,
    pnl,
    pnlPct: starting > 0 ? pnl / starting : 0,
  }));
}

/**
 * Largest peak-to-trough drawdown across the chronological equity curve
 * built from closed trades. Returns a non-negative USD figure (always ≥ 0).
 * null when there are no trades.
 *
 * Note: only realized P&L is included. Unrealized intra-trade drawdown
 * isn't tracked because we don't store mark-to-market history.
 */
export function computeMaxDrawdown(trades: Trade[]): number | null {
  if (trades.length === 0) return null;
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of sorted) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}

/**
 * Streak of consecutive winning trades counting back from the most recent.
 * Stops at the first non-win. Zero trades → 0 (no streak).
 */
export function computeWinStreak(trades: Trade[]): number {
  if (trades.length === 0) return 0;
  const sorted = [...trades].sort((a, b) => b.exitTime - a.exitTime);
  let streak = 0;
  for (const t of sorted) {
    if (t.pnl > 0) streak++;
    else break;
  }
  return streak;
}

// ---- Formatters --------------------------------------------------------

/** Format seconds as e.g. "2h 14min" or "47min" or "0min". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds <= 0) return "0min";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return `${h}h ${m}min`;
}

/** Format a fraction (0.583) as a percentage string ("58.3%"). null → "—". */
export function formatPercent(fraction: number | null, digits = 1): string {
  if (fraction === null) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Format a USD amount with sign+dollar formatting. null → "—". */
export function formatMoney(usd: number | null, signed = false): string {
  if (usd === null) return "—";
  const positive = usd >= 0;
  const sign = signed ? (positive ? "+" : "−") : positive ? "" : "−";
  return `${sign}$${Math.abs(usd).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
