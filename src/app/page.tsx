"use client";

import {
  Activity,
  BarChart3,
  Clock,
  Plus,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BattlesSummary } from "@/components/dashboard/BattlesSummary";
import { RecentSessionsTable } from "@/components/dashboard/RecentSessionsTable";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { UserOverview } from "@/components/dashboard/UserOverview";
import { NewSessionDialog } from "@/components/trade/NewSessionDialog";
import { Button } from "@/components/ui/button";
import {
  computeOverview,
  computePerSessionPnl,
  computeWinStreak,
  formatDuration,
  formatMoney,
  formatPercent,
  type OverviewStats,
  type SessionPnl,
} from "@/lib/analytics/stats";
import {
  classifyTraderKind,
  type TraderKind,
} from "@/lib/analytics/trader-kind";
import { sessionRepository } from "@/lib/repository/SessionRepository";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import type { Session } from "@/types/session";

interface DashboardData {
  sessions: Session[];
  perSessionPnl: SessionPnl[];
  overview: OverviewStats;
  traderKind: TraderKind;
  winStreak: number;
}

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sessions, trades] = await Promise.all([
        sessionRepository.list(),
        tradeRepository.listAll(),
      ]);
      if (cancelled) return;
      setData({
        sessions,
        perSessionPnl: computePerSessionPnl(sessions, trades),
        overview: computeOverview(sessions, trades),
        traderKind: classifyTraderKind(trades),
        winStreak: computeWinStreak(trades),
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Dashboard
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">FXTrader</h1>
        </div>
        <Button size="lg" onClick={() => setNewSessionOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Start new session
        </Button>
      </header>

      {loading ? (
        <DashboardSkeleton />
      ) : !data || data.sessions.length === 0 ? (
        <EmptyState onStart={() => setNewSessionOpen(true)} />
      ) : (
        <Loaded data={data} />
      )}

      <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} />
    </main>
  );
}

function Loaded({ data }: { data: DashboardData }) {
  const { sessions, perSessionPnl, overview, traderKind, winStreak } = data;
  const { winRate, expectancy, maxDrawdown, maxPnl, maxPnlPct, timePlayedSeconds, trades } =
    overview;

  return (
    <>
      <UserOverview
        traderKind={traderKind}
        battlesCount={0}
        winStreak={winStreak}
        totalSessions={sessions.length}
      />

      {/* Stats grid — 4 spec cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          icon={Target}
          label="Win rate"
          value={formatPercent(winRate)}
          hint={
            winRate === null
              ? "No closed trades yet"
              : `${overview.wins} W · ${overview.losses} L`
          }
        />
        <StatsCard
          icon={TrendingUp}
          label="Max session P&L"
          value={formatMoney(maxPnl, true)}
          hint={maxPnlPct === null ? undefined : formatPercent(maxPnlPct, 2)}
          accent={maxPnl !== null && maxPnl >= 0 ? "bull" : maxPnl !== null ? "bear" : "neutral"}
        />
        <StatsCard
          icon={Clock}
          label="Time played"
          value={formatDuration(timePlayedSeconds)}
        />
        <StatsCard
          icon={BarChart3}
          label="Trades taken"
          value={trades.toString()}
          hint={
            expectancy === null
              ? undefined
              : `Expectancy ${formatMoney(expectancy, true)} / trade`
          }
        />
      </div>

      {/* Secondary row — drawdown + battles placeholder */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <StatsCard
          icon={Activity}
          label="Max drawdown"
          value={formatMoney(maxDrawdown)}
          hint={
            maxDrawdown === null
              ? "—"
              : maxDrawdown > 0
                ? "Peak-to-trough across all trades"
                : "No drawdown yet"
          }
          accent={maxDrawdown && maxDrawdown > 0 ? "bear" : "neutral"}
        />
        <div className="lg:col-span-2">
          <BattlesSummary />
        </div>
      </div>

      <RecentSessionsTable sessions={sessions} perSessionPnl={perSessionPnl} />
    </>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        No history yet
      </p>
      <h2 className="text-2xl font-semibold tracking-tight">
        Start your first session
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Pick an instrument and a starting balance. Replay historical price
        action bar-by-bar and place simulated trades against it.
      </p>
      <Button size="lg" onClick={onStart}>
        <Plus className="mr-2 h-4 w-4" />
        Start new session
      </Button>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="h-24 animate-pulse rounded-xl bg-card/40" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-card/40" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl bg-card/40" />
    </div>
  );
}
