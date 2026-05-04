// Server-side validation for v2.2 battle attempt submissions.
//
// These run inside convex/battles.ts:submitAttempt as a guard against
// tampering. Per A2: NOT replay verification. Just internal-consistency
// checks that catch the easy class of fraud (editing one number but
// not the other consistently).
//
// The src/ copy is the canonical one with tests; convex/ inlines a copy
// because convex/ runs in its own runtime. Same pattern as
// src/lib/auth/emailNormalize → convex/auth.ts.

// pnlPct is reported as a percentage (e.g. 35 means +35%). The math
// must match (finalBalance - startingBalance) / startingBalance * 100
// within a small tolerance. 0.5 percentage points allows for legitimate
// rounding/calculation variance (commission, mid-bar timing) while
// catching obvious mismatches like finalBalance=10000 + pnlPct=50.
const PNL_PCT_EPSILON = 0.5;

// Bounds. None of these are tight; they're sanity rails to reject
// Number.MAX_VALUE / NaN / Infinity / negative-trades shenanigans.
const PNL_PCT_MIN = -100; // can't lose more than 100% (liquidation floor)
const PNL_PCT_MAX = 1000; // 11x return is the absurd ceiling
const WIN_RATE_MIN = 0;
const WIN_RATE_MAX = 1;

export interface AttemptResult {
  startingBalance: number;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
}

export function validateAttemptResult(args: AttemptResult): string | null {
  const { startingBalance, finalBalance, pnlPct, trades, winRate } = args;

  // Finite-number gate first. Number.isFinite returns false for NaN,
  // ±Infinity. Catches client tampering that submits parsed-bad values.
  if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
    return "Invalid starting balance.";
  }
  if (!Number.isFinite(finalBalance)) return "Invalid final balance.";
  if (!Number.isFinite(pnlPct)) return "Invalid P&L percentage.";
  if (!Number.isFinite(trades) || !Number.isInteger(trades) || trades < 0) {
    return "Invalid trade count.";
  }
  if (!Number.isFinite(winRate)) return "Invalid win rate.";

  // Bounds.
  if (pnlPct < PNL_PCT_MIN || pnlPct > PNL_PCT_MAX) {
    return `P&L percentage out of range [${PNL_PCT_MIN}, ${PNL_PCT_MAX}].`;
  }
  if (winRate < WIN_RATE_MIN || winRate > WIN_RATE_MAX) {
    return `Win rate must be between ${WIN_RATE_MIN} and ${WIN_RATE_MAX}.`;
  }

  // Internal consistency: pnlPct must match the math against balances.
  // Catches "edit one number, not the other" tampering.
  const expectedPnlPct =
    ((finalBalance - startingBalance) / startingBalance) * 100;
  if (Math.abs(pnlPct - expectedPnlPct) > PNL_PCT_EPSILON) {
    return "P&L percentage does not match balance change.";
  }

  return null;
}
