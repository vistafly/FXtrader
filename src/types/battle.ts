export interface BattleRules {
  maxDrawdownPct?: number;
  maxLossPerTradePct?: number;
  requireStopLoss?: boolean;
}

export interface BattleAttempt {
  id: string;
  battleId: string;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
  completedAt: number;
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
