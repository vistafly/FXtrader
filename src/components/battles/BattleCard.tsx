"use client";

import { useQuery } from "convex/react";
import {
  CheckCircle2,
  Clock,
  Crown,
  Globe,
  Hourglass,
  Lock,
  Play,
  ShieldX,
  Swords,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

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

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface Props {
  battle: Battle;
  attempts: BattleAttempt[];
  // v2.2: where this battle's data lives. Defaults to "local" so existing
  // v1 callers don't need to specify. Server battles get a multiplayer
  // badge and a visibility indicator.
  source?: BattleSource;
  visibility?: "public" | "invite-only";
  /** v2.3: when the host clicked "Start match" (ms wall-clock).
   *  Absent ⇒ lobby state. Drives the status badge + countdown. */
  startedAt?: number;
}

type BattleStatus = "lobby" | "in-progress" | "ended";

/**
 * Derive a battle's lifecycle status from startedAt + duration.
 *   undefined startedAt → "lobby" (host hasn't started)
 *   startedAt set, now < startedAt + duration → "in-progress"
 *   startedAt set, now ≥ startedAt + duration → "ended"
 *
 * Wall-clock based, not replay-clock. The replay can run at any
 * speed per-attempt, but the BATTLE window is wall-clock — that's
 * how friends compete on the same window of history within the
 * same time bucket.
 */
function deriveStatus(
  startedAt: number | undefined,
  durationMinutes: number | undefined,
  now: number,
): BattleStatus {
  if (!startedAt) return "lobby";
  if (durationMinutes === undefined) return "in-progress";
  const endsAt = startedAt + durationMinutes * 60 * 1000;
  return now < endsAt ? "in-progress" : "ended";
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function BattleCard({
  battle,
  attempts,
  source = "local",
  visibility,
  startedAt,
}: Props) {
  const ranked = rankAttempts(attempts);
  const best = bestAttempt(attempts);
  const dq = countDisqualified(attempts);
  const isProfit = best ? best.pnlPct >= 0 : false;
  const isServer = source === "server";

  // v2.3: live lobby presence for server battles. The query is a
  // Convex live subscription so the participant chip updates as
  // friends arrive / leave the waiting room without polling.
  const lobbyMembers = useQuery(
    api.lobby.listLobbyMembers,
    isServer ? { battleId: battle.id as Id<"battles"> } : "skip",
  );
  const lobbyCount = lobbyMembers?.length ?? 0;

  // v2.3: status + countdown tick. Wall-clock based. Per-card
  // setInterval is fine at friends-only scale (5-10 cards). Stops
  // ticking once the battle is ended.
  const [now, setNow] = useState(() => Date.now());
  const status = isServer
    ? deriveStatus(startedAt, battle.durationMinutes, now)
    : null;
  useEffect(() => {
    if (status !== "in-progress") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);
  const timeLeftMs =
    startedAt !== undefined && battle.durationMinutes !== undefined
      ? startedAt + battle.durationMinutes * 60 * 1000 - now
      : 0;

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
            {/* v2.3: lifecycle status badge — primary affordance for
                "is this battle joinable / playing / done?" */}
            {status === "lobby" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-400">
                <Hourglass className="h-2.5 w-2.5" />
                Lobby
              </span>
            )}
            {status === "in-progress" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-400">
                <Play className="h-2.5 w-2.5" />
                In progress
              </span>
            )}
            {status === "ended" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 className="h-2.5 w-2.5" />
                Ended
              </span>
            )}
            <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
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

      {/* v2.3: live status row. For server battles in lobby state we
          surface the realtime member count (joinLobby presence) with
          a soft pulse so the user sees "people are gathering". For
          in-progress battles we show the wall-clock countdown to
          end-of-window. Ended/local battles fall back to the
          ranked-attempts count. */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {isServer && status === "lobby" ? (
            <span className="inline-flex items-center gap-1.5 text-amber-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              {lobbyCount} in lobby
            </span>
          ) : isServer && status === "in-progress" ? (
            <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-emerald-400">
              <Clock className="h-3 w-3" />
              {formatTimeLeft(timeLeftMs)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {ranked.length} ranked
            </span>
          )}
          {dq > 0 && (
            <span className="inline-flex items-center gap-1 text-bear">
              <ShieldX className="h-3 w-3" />
              {dq} DQ
            </span>
          )}
        </div>
        <Button asChild size="sm" variant={status === "ended" ? "outline" : "default"}>
          <Link href={buildBattleUrl(source, battle.id)}>
            {status === "lobby" ? "Join" : status === "ended" ? "View" : "Enter"}
          </Link>
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
