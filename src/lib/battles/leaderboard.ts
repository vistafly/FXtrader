import type { BattleAttempt } from "@/types/battle";

/**
 * Sort attempts for leaderboard display. Disqualified attempts are
 * EXCLUDED entirely — they exist on the attempt list (so users can see
 * what happened) but never compete for rank.
 *
 * Primary sort: pnlPct descending (highest profit first).
 * Tie-break: completedAt ascending (earlier completion wins).
 */
export function rankAttempts(attempts: BattleAttempt[]): BattleAttempt[] {
  return attempts
    .filter((a) => !a.disqualified)
    .slice()
    .sort((a, b) => {
      if (b.pnlPct !== a.pnlPct) return b.pnlPct - a.pnlPct;
      return a.completedAt - b.completedAt;
    });
}

/**
 * Returns the user's best ranked attempt for the leaderboard preview on
 * the dashboard, or null if every attempt was DQ'd (or there are none).
 */
export function bestAttempt(
  attempts: BattleAttempt[],
): BattleAttempt | null {
  const ranked = rankAttempts(attempts);
  return ranked[0] ?? null;
}

/** Count of disqualified attempts (for the "0 ranked / 1 DQ'd" display). */
export function countDisqualified(attempts: BattleAttempt[]): number {
  return attempts.reduce((n, a) => (a.disqualified ? n + 1 : n), 0);
}
