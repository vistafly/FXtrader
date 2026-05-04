export interface BattleRules {
  maxDrawdownPct?: number;
  maxLossPerTradePct?: number;
  requireStopLoss?: boolean;
  /** v2.2: optional profit target (ratio, e.g. 0.20 = 20%). Display only;
   *  no auto-end on hit. Leaderboard shows a "target hit" badge for
   *  attempts whose pnlPct >= profitTargetPct. */
  profitTargetPct?: number;
}

export interface BattleAttempt {
  id: string;
  battleId: string;
  /** Session this attempt was played in. */
  sessionId: string;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
  completedAt: number;
  /** True if the attempt ended due to a battle-rule violation (e.g.
   *  exceeded maxDrawdownPct). DQ'd attempts are excluded from the
   *  leaderboard but kept on record in the attempt list. */
  disqualified: boolean;
  /** Short reason string when disqualified — used by the attempt detail UI. */
  disqualificationReason?: string;
}

export interface Battle {
  id: string;
  name: string;
  /** Single-instrument: v1 local battles set this; v2 server battles
   *  also set it (= instruments[0]) so legacy renderers keep working. */
  instrument: string;
  /** v2.2: server battles store an array of 1-5 instruments. Trade view
   *  uses instruments[0] in v2.2 (form-only multi-asset); full per-
   *  instrument switching during play is v2.2.5. Local battles leave
   *  this undefined. */
  instruments?: string[];
  startBarTime: number;
  /** v1 local battles store duration in bars (1 bar/sec at 1× speed). */
  durationBars: number;
  /** v2.2 server battles store duration in minutes. The card/detail
   *  rendering prefers this when present. Convex schema uses minutes
   *  natively; v1 local stays on bars for backwards compat. */
  durationMinutes?: number;
  startingBalance: number;
  /** v2.2: server battles cap distinct submitter count via this field.
   *  v1 local battles ignore it. */
  maxParticipants?: number;
  rules: BattleRules;
  attempts: BattleAttempt[];
}
