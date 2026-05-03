"use client";

import { ArrowLeft, Plus, Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { Leaderboard } from "@/components/battles/Leaderboard";
import { ErrorBoundary } from "@/components/ErrorFallback";
import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/analytics/stats";
import { battleRepository } from "@/lib/repository/BattleRepository";
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Battle, BattleAttempt } from "@/types/battle";

export default function BattleDetailPage({
  params,
}: {
  params: Promise<{ battleId: string }>;
}) {
  const { battleId } = use(params);
  const router = useRouter();
  const [battle, setBattle] = useState<Battle | null>(null);
  const [attempts, setAttempts] = useState<BattleAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [b, a] = await Promise.all([
        battleRepository.getBattle(battleId),
        battleRepository.listAttempts(battleId),
      ]);
      if (cancelled) return;
      setBattle(b ?? null);
      setAttempts(a);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [battleId]);

  const onNewAttempt = async () => {
    if (!battle) return;
    if (starting) return;
    setStarting(true);
    try {
      // Phase 7 D6 — fresh session every attempt.
      useOrderStore.getState().resetForSession();
      const session = await useSessionStore.getState().startSession({
        name: `${battle.name} · attempt`,
        instrument: battle.instrument,
        startBarTime: battle.startBarTime,
        startingBalance: battle.startingBalance,
        battle,
      });
      router.push(`/trade/${session.id}`);
    } catch (err) {
      toast.error(`Could not start attempt: ${(err as Error).message}`);
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="h-32 animate-pulse rounded-xl bg-card/40" />
        <div className="h-64 animate-pulse rounded-xl bg-card/40" />
      </main>
    );
  }

  if (!battle) {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-muted-foreground">Battle not found.</p>
        <Button asChild variant="ghost">
          <Link href="/battles">Back to lobby</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/battles"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Battles
          </Link>
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" />
            <h1 className="text-3xl font-semibold tracking-tight">{battle.name}</h1>
          </div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {battle.instrument} · {battle.durationBars} bars · ${battle.startingBalance.toLocaleString()}
          </p>
        </div>
        <Button size="lg" onClick={onNewAttempt} disabled={starting}>
          <Plus className="mr-2 h-4 w-4" />
          {starting ? "Starting…" : "New attempt"}
        </Button>
      </header>

      {/* Rules summary */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Rules
        </p>
        <ul className="space-y-1 text-sm">
          {battle.rules.maxDrawdownPct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max drawdown:</span>{" "}
              <span className="font-mono">{formatPercent(battle.rules.maxDrawdownPct)}</span>
              <span className="text-muted-foreground"> (auto-disqualifies attempt)</span>
            </li>
          )}
          {battle.rules.maxLossPerTradePct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max loss/trade:</span>{" "}
              <span className="font-mono">{formatPercent(battle.rules.maxLossPerTradePct)}</span>
              <span className="text-muted-foreground"> of balance (blocks order on submit)</span>
            </li>
          )}
          {battle.rules.requireStopLoss && (
            <li>
              <span className="text-muted-foreground">Stop loss required on every order.</span>
            </li>
          )}
          {!battle.rules.maxDrawdownPct &&
            !battle.rules.maxLossPerTradePct &&
            !battle.rules.requireStopLoss && (
              <li className="text-muted-foreground">No rules — free play.</li>
            )}
        </ul>
      </div>

      <ErrorBoundary label="Leaderboard">
        <Leaderboard attempts={attempts} />
      </ErrorBoundary>
    </main>
  );
}
