"use client";

import { useQuery } from "convex/react";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Hourglass,
  Medal,
  ShieldX,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface Props {
  battleId: Id<"battles">;
  /** UserId of the local player — used to highlight their row. */
  myUserId: string | undefined;
}

/**
 * v2.3 sub-phase 4: in-trade leaderboard drawer (immersive variant).
 *
 * Live `useQuery(api.battles.listAttempts)` so the panel updates as
 * other participants submit. Rendered with rank medallions for the
 * top three (gold/silver/bronze), ordinal suffixes (4th, 5th, …)
 * for the rest, and a glowing primary ring around the local
 * player's row. The local player's in-flight P&L is read live
 * from `sessionStore.balance` so they see their own number ticking
 * in real time even before submission.
 *
 * Default-collapsed; the edge tab is the only visible affordance
 * until the user opens it. Persists open/closed within the session.
 */
export function LeaderboardPanel({ battleId, myUserId }: Props) {
  const attempts = useQuery(api.battles.listAttempts, { battleId });
  const [open, setOpen] = useState(false);

  // Live P&L for the local player's in-flight attempt — pulled
  // directly from the session store rather than from Convex (which
  // only has the row's snapshot at last submission).
  const myLiveBalance = useSessionStore((s) => s.balance);
  const myStartingBalance = useSessionStore(
    (s) => s.activeSession?.startingBalance ?? 0,
  );
  const myLivePnlPct =
    myStartingBalance > 0
      ? ((myLiveBalance - myStartingBalance) / myStartingBalance) * 100
      : 0;
  // v2.3 sub-phase 4: live CLOSED-trade count for the local user.
  // Closed-only is the correct signal: open positions are
  // unrealized — the user hasn't actually banked a result. They
  // stay in "In flight" until they close at least one position.
  const myLiveTrades = useOrderStore((s) => s.closedTrades.length);

  const list = attempts ?? [];

  // v2.3 sub-phase 4: dedupe by userId. The same user can have
  // multiple historical attempts on a battle (created via earlier
  // test cycles, broken flows, etc.). For the live leaderboard we
  // want one entry per participant per category. Per-user
  // priority: in-flight > completed > disqualified. Within a
  // category, keep the most recently created/submitted row.
  type Row = (typeof list)[number];
  const dedupeByUser = (rows: Row[], byField: keyof Row): Row[] => {
    const map = new Map<string, Row>();
    for (const r of rows) {
      const existing = map.get(r.userId);
      if (
        !existing ||
        ((r[byField] as number) ?? 0) > ((existing[byField] as number) ?? 0)
      ) {
        map.set(r.userId, r);
      }
    }
    return [...map.values()];
  };

  // Best in-flight row per user (most recently created).
  const inFlightAll = list.filter((a) => a.status === "in-flight");
  const inFlightDeduped = dedupeByUser(inFlightAll, "_creationTime");

  // v2.3 sub-phase 4 split:
  //   Active (in-flight WITH trades): ranked live by pnlPct
  //   InFlightWaiting: hasn't placed a trade yet
  //
  // Self-classification override: the heartbeat lags up to 5s, so
  // a user who just placed a trade would still appear "in-flight
  // waiting" until their next heartbeat. For the local user we
  // read trades count directly from orderStore — instant transition
  // from "in flight" to "active" the moment they place a trade.
  const isActive = (a: Row): boolean => {
    if (myUserId && a.userId === myUserId) {
      return myLiveTrades > 0;
    }
    return (a.trades ?? 0) > 0;
  };
  const active = inFlightDeduped
    .filter(isActive)
    .sort((a, b) => b.pnlPct - a.pnlPct);
  const inFlightWaiting = inFlightDeduped.filter((a) => !isActive(a));

  // Highest-pnl completed row per user.
  const completedAll = list.filter(
    (a) => a.status === "completed" && !a.disqualified,
  );
  const completed = dedupeByUser(completedAll, "pnlPct").sort(
    (a, b) => b.pnlPct - a.pnlPct,
  );

  // Most recent DQ per user — but only if user doesn't have a
  // completed/in-flight row showing (else we'd double-list them).
  const usersAlreadyShown = new Set<string>([
    ...active.map((a) => a.userId),
    ...inFlightWaiting.map((a) => a.userId),
    ...completed.map((a) => a.userId),
  ]);
  const disqualified = dedupeByUser(
    list.filter((a) => a.disqualified),
    "_creationTime",
  ).filter((a) => !usersAlreadyShown.has(a.userId));

  const totalCount = list.length;
  const myCompletedRank = (() => {
    if (!myUserId) return null;
    const idx = completed.findIndex((a) => a.userId === myUserId);
    return idx >= 0 ? idx + 1 : null;
  })();
  // v2.3 sub-phase 4: live rank among actively-trading participants.
  // Computed in two paths because the local user's pnlPct in `active`
  // is from the 5s heartbeat (stale); we want their LIVE balance for
  // their own row + the rank computation.
  const activeWithLiveSelf = (() => {
    if (!myUserId) return active;
    const myRow = active.find((a) => a.userId === myUserId);
    if (!myRow) return active;
    return active
      .map((a) =>
        a.userId === myUserId ? { ...a, pnlPct: myLivePnlPct } : a,
      )
      .sort((a, b) => b.pnlPct - a.pnlPct);
  })();
  const myActiveRank = (() => {
    if (!myUserId) return null;
    const idx = activeWithLiveSelf.findIndex((a) => a.userId === myUserId);
    return idx >= 0 ? idx + 1 : null;
  })();
  const myInFlightWaiting =
    !!myUserId && inFlightWaiting.some((a) => a.userId === myUserId);
  const myActive = !!myUserId && active.some((a) => a.userId === myUserId);

  return (
    <>
      {/* Edge-pull tab — visible when collapsed. */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "absolute top-1/2 z-30 flex h-14 w-5 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground",
        )}
        style={{ left: open ? "320px" : "0px" }}
        aria-label={open ? "Hide leaderboard" : "Show leaderboard"}
      >
        {open ? (
          <ChevronLeft className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <aside
          className={cn(
            "absolute left-0 top-0 z-20 flex h-full w-[320px] shrink-0 flex-col",
            "border-r border-border bg-gradient-to-b from-card/90 via-card/80 to-card/70 backdrop-blur-md",
            "shadow-[8px_0_24px_rgba(0,0,0,0.25)]",
          )}
        >
          {/* Hero header */}
          <div className="border-b border-border bg-gradient-to-b from-primary/10 to-transparent px-4 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Leaderboard
              </h2>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {totalCount} {totalCount === 1 ? "entry" : "entries"}
              </span>
            </div>

            {/* "You" callout */}
            {myUserId && (
              <div className="mt-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-primary/80">
                  Your standing
                </p>
                {myActive && myActiveRank !== null ? (
                  // Actively trading + has live rank
                  <>
                    <div className="mt-1 flex items-baseline gap-3">
                      <RankBadge rank={myActiveRank} large />
                      <span className="font-mono text-[10px] text-muted-foreground">
                        of {activeWithLiveSelf.length} live
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-amber-400">
                        Live
                      </span>
                      <PnlDisplay pnlPct={myLivePnlPct} large />
                    </div>
                  </>
                ) : myInFlightWaiting ? (
                  // Joined the battle but hasn't placed a trade yet
                  <>
                    <p className="mt-1 text-sm text-foreground">
                      Ready to trade
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Place your first order to enter the live ranking
                    </p>
                  </>
                ) : myCompletedRank !== null ? (
                  <div className="mt-1 flex items-baseline gap-3">
                    <RankBadge rank={myCompletedRank} large />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      of {completed.length}
                    </span>
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Not yet ranked
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Active section — currently-trading users with at
                least one trade, ranked live by P&L. Self uses the
                local sessionStore (instantaneous tick); others use
                the row's pnlPct field, which the trade-page heartbeat
                patches every 5s. Re-sorted with self's live value. */}
            {activeWithLiveSelf.length > 0 && (
              <Section
                title="Live"
                icon={<TrendingUp className="h-3 w-3" />}
                accent="default"
              >
                {activeWithLiveSelf.map((a, i) => {
                  const isMe = !!myUserId && a.userId === myUserId;
                  return (
                    <Row
                      key={a._id}
                      rank={i + 1}
                      name={a.displayNameSnapshot}
                      pnlPct={a.pnlPct}
                      status="in-flight"
                      isMe={isMe}
                      live
                    />
                  );
                })}
              </Section>
            )}

            {/* Completed section — already submitted, locked stats */}
            {completed.length > 0 && (
              <Section
                title="Ranked"
                icon={<Crown className="h-3 w-3" />}
                accent="default"
              >
                {completed.map((a, i) => (
                  <Row
                    key={a._id}
                    rank={i + 1}
                    name={a.displayNameSnapshot}
                    pnlPct={a.pnlPct}
                    status="completed"
                    isMe={!!myUserId && a.userId === myUserId}
                  />
                ))}
              </Section>
            )}

            {/* In-flight (waiting) — joined but hasn't placed a
                trade yet. Not ranked since they have no P&L. */}
            {inFlightWaiting.length > 0 && (
              <Section
                title="In flight"
                icon={<Hourglass className="h-3 w-3" />}
                accent="warn"
              >
                {inFlightWaiting.map((a) => (
                  <Row
                    key={a._id}
                    rank={null}
                    name={a.displayNameSnapshot}
                    pnlPct={null}
                    status="in-flight"
                    isMe={!!myUserId && a.userId === myUserId}
                  />
                ))}
              </Section>
            )}

            {/* DQ section */}
            {disqualified.length > 0 && (
              <Section
                title="Disqualified"
                icon={<ShieldX className="h-3 w-3" />}
                accent="bear"
              >
                {disqualified.map((a) => (
                  <Row
                    key={a._id}
                    rank={null}
                    name={a.displayNameSnapshot}
                    pnlPct={a.pnlPct}
                    status="disqualified"
                    isMe={!!myUserId && a.userId === myUserId}
                    dqReason={a.disqualificationReason}
                  />
                ))}
              </Section>
            )}

            {totalCount === 0 && (
              <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                No attempts yet — be first.
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

// ---- Helpers ----------------------------------------------------------

/**
 * Ordinal rank with medallion treatment for top 3 (gold/silver/bronze)
 * and ordinal-suffixed numerals for the rest. Sized variants for hero
 * vs. row use.
 */
function RankBadge({ rank, large }: { rank: number; large?: boolean }) {
  if (rank === 1) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-yellow-400/40 bg-yellow-400/10 px-2 py-0.5 font-mono font-bold text-yellow-400",
          large ? "text-base" : "text-xs",
        )}
      >
        <Trophy className={large ? "h-4 w-4" : "h-3 w-3"} />
        1st
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-slate-300/40 bg-slate-300/10 px-2 py-0.5 font-mono font-bold text-slate-300",
          large ? "text-base" : "text-xs",
        )}
      >
        <Medal className={large ? "h-4 w-4" : "h-3 w-3"} />
        2nd
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-amber-700/40 bg-amber-700/10 px-2 py-0.5 font-mono font-bold text-amber-600",
          large ? "text-base" : "text-xs",
        )}
      >
        <Medal className={large ? "h-4 w-4" : "h-3 w-3"} />
        3rd
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-muted-foreground",
        large ? "text-base" : "text-xs",
      )}
    >
      {ordinal(rank)}
    </span>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0];
  return `${n}${suffix}`;
}

function PnlDisplay({
  pnlPct,
  large,
}: {
  pnlPct: number;
  large?: boolean;
}) {
  const isProfit = pnlPct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 font-mono font-bold tabular-nums",
        large ? "text-2xl" : "text-sm",
        isProfit ? "text-bull" : "text-bear",
      )}
    >
      {isProfit ? (
        <TrendingUp className={large ? "h-4 w-4" : "h-3 w-3"} />
      ) : (
        <TrendingDown className={large ? "h-4 w-4" : "h-3 w-3"} />
      )}
      {isProfit ? "+" : ""}
      {pnlPct.toFixed(2)}%
    </span>
  );
}

function Section({
  title,
  icon,
  accent,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: "default" | "warn" | "bear";
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/30">
      <div
        className={cn(
          "flex items-center gap-1.5 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.2em]",
          accent === "warn" && "text-amber-400",
          accent === "bear" && "text-bear",
          accent === "default" && "text-muted-foreground",
        )}
      >
        {icon}
        {title}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function Row({
  rank,
  name,
  pnlPct,
  status,
  isMe,
  dqReason,
  live,
}: {
  rank: number | null;
  name: string;
  pnlPct: number | null;
  status: "in-flight" | "completed" | "disqualified";
  isMe: boolean;
  dqReason?: string;
  /** v2.3 sub-phase 4: in-flight row with a live-updating P&L —
   *  adds a subtle "live" dot next to the number. */
  live?: boolean;
}) {
  return (
    <li
      className={cn(
        "relative flex items-center justify-between gap-2 border-l-2 px-4 py-2.5 transition-colors",
        isMe
          ? "border-l-primary bg-primary/5 ring-1 ring-inset ring-primary/30"
          : "border-l-transparent hover:bg-accent/30",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {rank !== null ? (
          <RankBadge rank={rank} />
        ) : (
          <span className="inline-flex w-12 shrink-0 justify-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            —
          </span>
        )}
        <span
          className={cn(
            "truncate text-sm",
            isMe ? "font-semibold text-primary" : "text-foreground",
            status === "disqualified" && "text-bear/70 line-through",
          )}
          title={dqReason}
        >
          {name}
          {isMe && (
            <span className="ml-1 font-mono text-[9px] uppercase tracking-wider text-primary/80">
              you
            </span>
          )}
        </span>
      </div>
      {pnlPct !== null ? (
        <span className="flex shrink-0 items-center gap-1.5">
          {live && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
            </span>
          )}
          <PnlDisplay pnlPct={pnlPct} />
        </span>
      ) : (
        <span className="shrink-0 animate-pulse font-mono text-[10px] uppercase tracking-wider text-amber-400">
          trading
        </span>
      )}
    </li>
  );
}
