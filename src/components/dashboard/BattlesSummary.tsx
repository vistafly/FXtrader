"use client";

import { Crown, Plus, Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/analytics/stats";
import { bestAttempt, countDisqualified } from "@/lib/battles/leaderboard";
import { battleRepository } from "@/lib/repository/BattleRepository";
import { cn } from "@/lib/utils";
import type { Battle, BattleAttempt } from "@/types/battle";

interface BattleWithAttempts {
  battle: Battle;
  attempts: BattleAttempt[];
}

/**
 * Compact battles preview for the dashboard. Shows up to 3 most-recent
 * battles with their best attempt; falls back to the empty-state CTA
 * when there are none.
 */
export function BattlesSummary() {
  const [data, setData] = useState<BattleWithAttempts[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const battles = await battleRepository.listBattles();
      const withAttempts = await Promise.all(
        battles.map(async (battle) => ({
          battle,
          attempts: await battleRepository.listAttempts(battle.id),
        })),
      );
      if (!cancelled) setData(withAttempts);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (data === null) {
    return <div className="h-32 animate-pulse rounded-xl bg-card/40" />;
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 bg-card/30 p-6 text-center">
        <Swords className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Battles</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Compete with yourself on a fixed window of history.
        </p>
        <Button asChild size="sm" variant="ghost" className="mt-3">
          <Link href="/battles">
            <Plus className="mr-1 h-3 w-3" />
            Create one
          </Link>
        </Button>
      </div>
    );
  }

  // Show up to 3 most recently created.
  const top = [...data]
    .sort((a, b) => b.battle.startBarTime - a.battle.startBarTime)
    .slice(0, 3);

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" />
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Battles
          </h3>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link href="/battles">View all →</Link>
        </Button>
      </div>
      <ul className="divide-y divide-border/60">
        {top.map(({ battle, attempts }) => {
          const best = bestAttempt(attempts);
          const dq = countDisqualified(attempts);
          return (
            <li key={battle.id}>
              <Link
                href={`/battles/${battle.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{battle.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {battle.instrument} · {attempts.length}{" "}
                    {attempts.length === 1 ? "attempt" : "attempts"}
                    {dq > 0 && ` · ${dq} DQ`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {best ? (
                    <>
                      <Crown
                        className={cn(
                          "h-3.5 w-3.5",
                          best.pnlPct >= 0 ? "text-bull" : "text-bear",
                        )}
                      />
                      <span
                        className={cn(
                          "font-mono text-sm",
                          best.pnlPct >= 0 ? "text-bull" : "text-bear",
                        )}
                      >
                        {best.pnlPct >= 0 ? "+" : ""}
                        {formatPercent(best.pnlPct, 2)}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">No attempts</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
