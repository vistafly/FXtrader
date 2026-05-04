"use client";

import { Crown, Globe, Lock, ShieldX, Swords, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/analytics/stats";
import {
  bestAttempt,
  countDisqualified,
  rankAttempts,
} from "@/lib/battles/leaderboard";
import { buildBattleUrl, type BattleSource } from "@/lib/battles/inviteCode";
import { cn } from "@/lib/utils";
import type { Battle, BattleAttempt } from "@/types/battle";

interface Props {
  battle: Battle;
  attempts: BattleAttempt[];
  // v2.2: where this battle's data lives. Defaults to "local" so existing
  // v1 callers don't need to specify. Server battles get a multiplayer
  // badge and a visibility indicator.
  source?: BattleSource;
  visibility?: "public" | "invite-only";
}

export function BattleCard({
  battle,
  attempts,
  source = "local",
  visibility,
}: Props) {
  const ranked = rankAttempts(attempts);
  const best = bestAttempt(attempts);
  const dq = countDisqualified(attempts);
  const isProfit = best ? best.pnlPct >= 0 : false;
  const isServer = source === "server";

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border/80 bg-card/50 p-5 transition-colors hover:bg-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            <Swords className="h-3 w-3" />
            <span>
              {battle.instruments && battle.instruments.length > 1
                ? `${battle.instruments[0]} +${battle.instruments.length - 1}`
                : battle.instrument}
            </span>
            <span>·</span>
            <span>
              {battle.durationMinutes !== undefined
                ? `${battle.durationMinutes} min`
                : `${battle.durationBars} bars`}
            </span>
            {battle.maxParticipants !== undefined && (
              <>
                <span>·</span>
                <span>
                  {ranked.length}/{battle.maxParticipants}
                </span>
              </>
            )}
          </div>
          <h3 className="mt-1 text-lg font-semibold tracking-tight">
            {battle.name}
          </h3>
        </div>
        {isServer && (
          <div className="flex flex-col items-end gap-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
              <Users className="h-2.5 w-2.5" />
              Multiplayer
            </span>
            {visibility && (
              <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {visibility === "public" ? (
                  <>
                    <Globe className="h-2.5 w-2.5" /> Public
                  </>
                ) : (
                  <>
                    <Lock className="h-2.5 w-2.5" /> Invite-only
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Rules pill row */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {battle.rules.profitTargetPct !== undefined && (
          <RulePill className="border-bull/40 text-bull">
            Target +{formatPercent(battle.rules.profitTargetPct)}
          </RulePill>
        )}
        {battle.rules.maxDrawdownPct !== undefined && (
          <RulePill>
            Max DD {formatPercent(battle.rules.maxDrawdownPct)}
          </RulePill>
        )}
        {battle.rules.maxLossPerTradePct !== undefined && (
          <RulePill>
            Max loss/trade {formatPercent(battle.rules.maxLossPerTradePct)}
          </RulePill>
        )}
        {battle.rules.requireStopLoss && <RulePill>SL required</RulePill>}
        {!battle.rules.profitTargetPct &&
          !battle.rules.maxDrawdownPct &&
          !battle.rules.maxLossPerTradePct &&
          !battle.rules.requireStopLoss && (
            <RulePill className="opacity-60">No rules — free play</RulePill>
          )}
      </div>

      {/* Best run */}
      <div className="rounded-md border border-border/60 bg-background/50 p-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Best attempt
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          {best ? (
            <>
              <Crown
                className={cn(
                  "h-4 w-4",
                  isProfit ? "text-bull" : "text-bear",
                )}
              />
              <span
                className={cn(
                  "font-mono text-xl font-bold tabular-nums",
                  isProfit ? "text-bull" : "text-bear",
                )}
              >
                {best.pnlPct >= 0 ? "+" : ""}
                {formatPercent(best.pnlPct, 2)}
              </span>
            </>
          ) : (
            <span className="font-mono text-sm text-muted-foreground">—</span>
          )}
        </div>
      </div>

      {/* Attempts summary + CTA */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {ranked.length} ranked
          </span>
          {dq > 0 && (
            <span className="inline-flex items-center gap-1 text-bear">
              <ShieldX className="h-3 w-3" />
              {dq} DQ
            </span>
          )}
        </div>
        <Button asChild size="sm">
          <Link href={buildBattleUrl(source, battle.id)}>Enter</Link>
        </Button>
      </div>
    </div>
  );
}

function RulePill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 font-mono uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
