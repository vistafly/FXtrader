export interface BattleRules {
  maxDrawdownPct?: number;
  maxLossPerTradePct?: number;
  requireStopLoss?: boolean;
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
  instrument: string;
  startBarTime: number;
  durationBars: number;
  startingBalance: number;
  rules: BattleRules;
  attempts: BattleAttempt[];
}
