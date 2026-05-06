"use client";

import { useQuery } from "convex/react";
import { Medal, Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface Props {
  battleId: Id<"battles">;
  myUserId: string | undefined;
}

/**
 * v2.3 sub-phase 4: compact rank indicator for the trade-page header.
 *
 * Shows the user's CURRENT live placement among actively-trading
 * participants — same data path the LeaderboardPanel uses. Renders
 * a tiny medallion pill (gold/silver/bronze for top 3, ordinal
 * suffix otherwise) so the user has a glanceable view of where they
 * stand without opening the leaderboard drawer.
 *
 * Hidden when:
 *   - User has no live attempt
 *   - User hasn't placed a trade yet (not in the active ranking)
 *   - Less than 2 active traders (no point in a "1 of 1" pill)
 */
export function RankIndicator({ battleId, myUserId }: Props) {
  const attempts = useQuery(api.battles.listAttempts, { battleId });

  const myLiveBalance = useSessionStore((s) => s.balance);
  const myStartingBalance = useSessionStore(
    (s) => s.activeSession?.startingBalance ?? 0,
  );
  const myLivePnlPct =
    myStartingBalance > 0
      ? ((myLiveBalance - myStartingBalance) / myStartingBalance) * 100
      : 0;
  // Closed trades only — see LeaderboardPanel for rationale.
  const myLiveTrades = useOrderStore((s) => s.closedTrades.length);

  if (!attempts || !myUserId) return null;

  // Same dedupe + active-only filter the LeaderboardPanel uses.
  type Row = (typeof attempts)[number];
  const dedupe = (rows: Row[]): Row[] => {
    const map = new Map<string, Row>();
    for (const r of rows) {
      const existing = map.get(r.userId);
      if (
        !existing ||
        (r._creationTime ?? 0) > (existing._creationTime ?? 0)
      ) {
        map.set(r.userId, r);
      }
    }
    return [...map.values()];
  };
  const inFlight = dedupe(attempts.filter((a) => a.status === "in-flight"));
  // Self-classification override matches LeaderboardPanel's logic:
  // local trades count is instant; others lag 5s on the heartbeat.
  const active = inFlight.filter((a) => {
    if (a.userId === myUserId) return myLiveTrades > 0;
    return (a.trades ?? 0) > 0;
  });

  // Override self's pnlPct with the live local value before ranking.
  const ranked = active
    .map((a) =>
      a.userId === myUserId ? { ...a, pnlPct: myLivePnlPct } : a,
    )
    .sort((a, b) => b.pnlPct - a.pnlPct);

  const myRank = ranked.findIndex((a) => a.userId === myUserId) + 1;

  // Hide when user isn't in the active ranking or there aren't
  // enough participants to make ranking meaningful.
  if (myRank === 0) return null;
  if (ranked.length < 2) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-bold tabular-nums shadow-sm",
        myRank === 1 &&
          "border border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
        myRank === 2 &&
          "border border-slate-300/40 bg-slate-300/10 text-slate-300",
        myRank === 3 &&
          "border border-amber-700/40 bg-amber-700/10 text-amber-600",
        myRank > 3 &&
          "border border-border bg-muted/40 text-muted-foreground",
      )}
      aria-label={`Rank ${myRank} of ${ranked.length}`}
      title={`You are ranked ${myRank} of ${ranked.length} active traders`}
    >
      {myRank === 1 && <Trophy className="h-3 w-3" />}
      {(myRank === 2 || myRank === 3) && <Medal className="h-3 w-3" />}
      {ordinal(myRank)}
      <span className="text-[10px] opacity-70">/ {ranked.length}</span>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0];
  return `${n}${suffix}`;
}
