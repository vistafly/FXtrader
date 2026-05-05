"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, Copy, Globe, Lock, Plus, Swords, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";

import { UserMenu } from "@/components/auth/UserMenu";
import { Leaderboard } from "@/components/battles/Leaderboard";
import { ErrorBoundary } from "@/components/ErrorFallback";
import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/analytics/stats";
import {
  buildInviteUrl,
  parseBattleId,
  type BattleSource,
} from "@/lib/battles/inviteCode";
import { battleRepository } from "@/lib/repository/BattleRepository";
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Battle, BattleAttempt } from "@/types/battle";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function BattleDetailPage({
  params,
}: {
  params: Promise<{ battleId: string }>;
}) {
  const { battleId: raw } = use(params);
  const parsed = parseBattleId(raw);
  const router = useRouter();

  // Server-side data via Convex (reactive). The "skip" sentinel means
  // the query is bypassed when the URL is a local-prefixed battle.
  const serverBattle = useQuery(
    api.battles.getBattle,
    parsed.source === "server"
      ? { battleId: parsed.id as Id<"battles"> }
      : "skip",
  );
  const serverAttempts = useQuery(
    api.battles.listAttempts,
    parsed.source === "server"
      ? { battleId: parsed.id as Id<"battles"> }
      : "skip",
  );

  // Local-side data via Dexie (one-shot load).
  const [localBattle, setLocalBattle] = useState<Battle | null>(null);
  const [localAttempts, setLocalAttempts] = useState<BattleAttempt[]>([]);
  const [localLoading, setLocalLoading] = useState(parsed.source === "local");

  useEffect(() => {
    if (parsed.source !== "local") return;
    let cancelled = false;
    void (async () => {
      const [b, a] = await Promise.all([
        battleRepository.getBattle(parsed.id),
        battleRepository.listAttempts(parsed.id),
      ]);
      if (cancelled) return;
      setLocalBattle(b ?? null);
      setLocalAttempts(a);
      setLocalLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [parsed.id, parsed.source]);

  const [starting, setStarting] = useState(false);

  // Captured at mount so render-time compares are pure. Expiration display
  // is approximate; users can refresh for an updated countdown.
  const [renderedAtMs] = useState(() => Date.now());

  // Normalize whichever data source is active to a unified shape.
  // `id` is the un-prefixed identifier (Dexie ID or Convex _id).
  const view = (() => {
    if (parsed.source === "server") {
      if (serverBattle === undefined || serverAttempts === undefined) {
        return { state: "loading" as const };
      }
      if (serverBattle === null) return { state: "missing" as const };
      // Defensive: legacy row from before the v2.2 schema rename. Treat
      // as missing so we don't crash on undefined.instruments[0]. The
      // operator should wipe the battles + battleAttempts tables in the
      // Convex dashboard after the v2.2 schema migration.
      if (
        !serverBattle.instruments ||
        serverBattle.instruments.length === 0 ||
        serverBattle.durationMinutes === undefined ||
        serverBattle.maxParticipants === undefined
      ) {
        return { state: "missing" as const };
      }
      const battleAsLocalShape: Battle = {
        id: serverBattle._id,
        name: serverBattle.name,
        instrument: serverBattle.instruments[0],
        instruments: serverBattle.instruments,
        startBarTime: serverBattle.startBarTime,
        // Convert minutes → bars for legacy consumers; v1's durationBars
        // is still the source of truth for engine session length. Server
        // battles use minutes (60 bars/min at 1× speed).
        durationBars: serverBattle.durationMinutes * 60,
        durationMinutes: serverBattle.durationMinutes,
        maxParticipants: serverBattle.maxParticipants,
        startingBalance: serverBattle.startingBalance,
        rules: serverBattle.rules,
        attempts: [],
      };
      const attemptsAsLocalShape: BattleAttempt[] = serverAttempts.map((a) => ({
        id: a._id,
        battleId: serverBattle._id,
        sessionId: "",
        finalBalance: a.finalBalance,
        // Server stores percentage (35); client unified type uses ratio
        // (0.35) for formatPercent compatibility. See lobby mapping for
        // the matching note.
        pnlPct: a.pnlPct / 100,
        trades: a.trades,
        winRate: a.winRate,
        completedAt: a.completedAt,
        disqualified: a.disqualified,
        disqualificationReason: a.disqualificationReason,
      }));
      return {
        state: "loaded" as const,
        battle: battleAsLocalShape,
        attempts: attemptsAsLocalShape,
        source: "server" as BattleSource,
        visibility: serverBattle.visibility,
        inviteCode: serverBattle.inviteCode,
        expiresAt: serverBattle.expiresAt,
      };
    }
    if (parsed.source === "local") {
      if (localLoading) return { state: "loading" as const };
      if (!localBattle) return { state: "missing" as const };
      return {
        state: "loaded" as const,
        battle: localBattle,
        attempts: localAttempts,
        source: "local" as BattleSource,
      };
    }
    // Unknown prefix → not found. Don't fall back to local; v1
    // unprefixed IDs were orphaned per §16.1 v2.1.5.
    return { state: "missing" as const };
  })();

  const onNewAttempt = async () => {
    if (view.state !== "loaded") return;
    if (starting) return;
    setStarting(true);
    try {
      useOrderStore.getState().resetForSession();
      // v2.2.5α: pass the full instruments[] when present so the trade view
      // boots all engines. Falls back to single instrument for v1 / legacy
      // single-asset battles.
      const instruments =
        view.battle.instruments && view.battle.instruments.length > 0
          ? view.battle.instruments
          : [view.battle.instrument];
      const session = await useSessionStore.getState().startSession({
        name: `${view.battle.name} · attempt`,
        instrument: instruments[0],
        instruments,
        startBarTime: view.battle.startBarTime,
        startingBalance: view.battle.startingBalance,
        battle: view.battle,
        battleSource: view.source,
      });
      router.push(`/trade/${session.id}`);
    } catch (err) {
      toast.error(`Could not start attempt: ${(err as Error).message}`);
      setStarting(false);
    }
  };

  const copyInviteLink = async () => {
    if (view.state !== "loaded" || view.source !== "server" || !view.inviteCode) {
      return;
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = buildInviteUrl(view.inviteCode, origin);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied to clipboard.");
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy manually.");
    }
  };

  if (view.state === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="h-32 animate-pulse rounded-xl bg-card/40" />
        <div className="h-64 animate-pulse rounded-xl bg-card/40" />
      </main>
    );
  }

  if (view.state === "missing") {
    return (
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <p className="text-muted-foreground">Battle not found.</p>
        <Button asChild variant="ghost">
          <Link href="/battles">Back to lobby</Link>
        </Button>
      </main>
    );
  }

  const expiresStatus =
    view.state === "loaded" && view.source === "server" && view.expiresAt
      ? renderedAtMs < view.expiresAt
        ? `Expires ${formatRelativeTime(view.expiresAt, renderedAtMs)}`
        : "Expired"
      : null;

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
            <h1 className="text-3xl font-semibold tracking-tight">
              {view.battle.name}
            </h1>
            {view.source === "server" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
                <Users className="h-2.5 w-2.5" />
                Multiplayer
              </span>
            )}
          </div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {view.battle.instruments && view.battle.instruments.length > 1
              ? view.battle.instruments.join(", ")
              : view.battle.instrument}{" "}
            ·{" "}
            {view.battle.durationMinutes !== undefined
              ? `${view.battle.durationMinutes} min`
              : `${view.battle.durationBars} bars`}{" "}
            · ${view.battle.startingBalance.toLocaleString()}
            {view.battle.maxParticipants !== undefined && (
              <>
                {" · "}
                {view.attempts.length}/{view.battle.maxParticipants}{" "}
                participants
              </>
            )}
            {view.source === "server" && view.visibility && (
              <>
                {" · "}
                <span className="inline-flex items-center gap-1">
                  {view.visibility === "public" ? (
                    <>
                      <Globe className="h-3 w-3" /> Public
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" /> Invite-only
                    </>
                  )}
                </span>
              </>
            )}
            {expiresStatus && <> · {expiresStatus}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {view.source === "server" && view.inviteCode && (
            <Button variant="ghost" onClick={copyInviteLink}>
              <Copy className="mr-2 h-4 w-4" />
              Copy invite link
            </Button>
          )}
          <Button size="lg" onClick={onNewAttempt} disabled={starting}>
            <Plus className="mr-2 h-4 w-4" />
            {starting ? "Starting…" : "New attempt"}
          </Button>
          <UserMenu />
        </div>
      </header>

      {/* v2.2 form-only multi-asset advisory: battles with >1 instrument
          configured but only the first plays in v2.2. Removed in v2.2.5
          when full per-instrument switching ships. */}
      {view.battle.instruments && view.battle.instruments.length > 1 && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
          <p className="font-medium">
            Multi-asset battle — playing {view.battle.instruments[0]} only in
            v2.2
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This battle was created with{" "}
            <span className="font-mono">
              {view.battle.instruments.join(", ")}
            </span>
            . v2.2 attempts play the first asset only. Per-instrument
            switching during play ships in v2.2.5.
          </p>
        </div>
      )}

      {/* Rules summary */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Rules
        </p>
        <ul className="space-y-1 text-sm">
          {view.battle.rules.profitTargetPct !== undefined && (
            <li>
              <span className="text-muted-foreground">Profit target:</span>{" "}
              <span className="font-mono text-bull">
                +{formatPercent(view.battle.rules.profitTargetPct)}
              </span>
              <span className="text-muted-foreground">
                {" "}
                (display only — no auto-end)
              </span>
            </li>
          )}
          {view.battle.rules.maxDrawdownPct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max drawdown:</span>{" "}
              <span className="font-mono">
                {formatPercent(view.battle.rules.maxDrawdownPct)}
              </span>
              <span className="text-muted-foreground">
                {" "}
                (auto-disqualifies attempt)
              </span>
            </li>
          )}
          {view.battle.rules.maxLossPerTradePct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max loss/trade:</span>{" "}
              <span className="font-mono">
                {formatPercent(view.battle.rules.maxLossPerTradePct)}
              </span>
              <span className="text-muted-foreground">
                {" "}
                of balance (blocks order on submit)
              </span>
            </li>
          )}
          {view.battle.rules.requireStopLoss && (
            <li>
              <span className="text-muted-foreground">
                Stop loss required on every order.
              </span>
            </li>
          )}
          {!view.battle.rules.profitTargetPct &&
            !view.battle.rules.maxDrawdownPct &&
            !view.battle.rules.maxLossPerTradePct &&
            !view.battle.rules.requireStopLoss && (
              <li className="text-muted-foreground">No rules — free play.</li>
            )}
        </ul>
      </div>

      <ErrorBoundary label="Leaderboard">
        <Leaderboard attempts={view.attempts} />
      </ErrorBoundary>
    </main>
  );
}

// Lightweight relative-time formatter. Pure — accepts `now` from caller
// (captured at mount via useState lazy initializer) so it can be invoked
// from render bodies without violating react-hooks/purity.
function formatRelativeTime(timestamp: number, now: number): string {
  const ms = timestamp - now;
  if (ms <= 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
