"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { UserMenu } from "@/components/auth/UserMenu";
import { BattleCard } from "@/components/battles/BattleCard";
import { CreateBattleDialog } from "@/components/battles/CreateBattleDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BattleSource } from "@/lib/battles/inviteCode";
import { battleRepository } from "@/lib/repository/BattleRepository";
import type { Battle, BattleAttempt } from "@/types/battle";

import { api } from "../../../convex/_generated/api";

type FilterTab = "active" | "completed" | "all";

interface BattleWithAttempts {
  battle: Battle;
  attempts: BattleAttempt[];
  source: BattleSource;
  visibility?: "public" | "invite-only";
  /** v2.3: server-side broadcast match-start timestamp (Date.now() ms).
   *  Drives the lobby/in-progress/ended status badge on the BattleCard. */
  startedAt?: number;
}

export default function BattlesLobbyPage() {
  const [localData, setLocalData] = useState<BattleWithAttempts[] | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const myServerBattles = useQuery(api.battles.listMyBattles, {});
  const publicServerBattles = useQuery(api.battles.listPublicBattles, {});

  const reloadLocal = async () => {
    const battles = await battleRepository.listBattles();
    const withAttempts: BattleWithAttempts[] = await Promise.all(
      battles.map(async (battle) => ({
        battle,
        attempts: await battleRepository.listAttempts(battle.id),
        source: "local" as const,
      })),
    );
    setLocalData(withAttempts);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const battles = await battleRepository.listBattles();
      const withAttempts: BattleWithAttempts[] = await Promise.all(
        battles.map(async (battle) => ({
          battle,
          attempts: await battleRepository.listAttempts(battle.id),
          source: "local" as const,
        })),
      );
      if (!cancelled) setLocalData(withAttempts);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge local + server battles; dedupe server-side battles that appear
  // in both myCreated and publicLobby (a creator's own public battle).
  const merged = useMemo<BattleWithAttempts[] | null>(() => {
    if (
      localData === null ||
      myServerBattles === undefined ||
      publicServerBattles === undefined
    ) {
      return null;
    }
    const seenIds = new Set<string>();
    const serverItems: BattleWithAttempts[] = [];
    const pushServer = (
      battle: (typeof myServerBattles)[number]["battle"],
      attempts: (typeof myServerBattles)[number]["attempts"],
    ) => {
      if (seenIds.has(battle._id)) return;
      // Defensive: skip rows missing the v2.2 schema (instruments[],
      // durationMinutes, maxParticipants). Happens when a row created
      // before the schema rename hasn't been wiped from the Convex
      // dashboard. Don't crash — just don't render the legacy row.
      if (
        !battle.instruments ||
        battle.instruments.length === 0 ||
        battle.durationMinutes === undefined ||
        battle.maxParticipants === undefined
      ) {
        return;
      }
      seenIds.add(battle._id);
      serverItems.push({
        battle: {
          id: battle._id,
          name: battle.name,
          // Form-only multi-asset (v2.2): expose the array AND a single
          // instrument for legacy v1 renderers / trade view (which uses
          // instruments[0] until v2.2.5).
          instrument: battle.instruments[0],
          instruments: battle.instruments,
          startBarTime: battle.startBarTime,
          // Convert minutes → bars (60 bars/min at 1× speed) so legacy
          // consumers that read durationBars still get a value.
          durationBars: battle.durationMinutes * 60,
          durationMinutes: battle.durationMinutes,
          startingBalance: battle.startingBalance,
          maxParticipants: battle.maxParticipants,
          rules: battle.rules,
          attempts: [],
        },
        attempts: attempts.map((a) => ({
          id: a._id,
          battleId: battle._id,
          sessionId: "",
          finalBalance: a.finalBalance,
          // Server stores pnlPct as a percentage (35 = +35%); v1's
          // BattleAttempt shape and `formatPercent` expect a ratio
          // (0.35 = +35%). Divide by 100 here so the unified type
          // is internally consistent.
          pnlPct: a.pnlPct / 100,
          trades: a.trades,
          winRate: a.winRate,
          completedAt: a.completedAt,
          disqualified: a.disqualified,
          disqualificationReason: a.disqualificationReason,
        })),
        source: "server",
        visibility: battle.visibility,
        startedAt: battle.startedAt,
      });
    };
    for (const row of myServerBattles) pushServer(row.battle, row.attempts);
    for (const row of publicServerBattles)
      pushServer(row.battle, row.attempts);
    return [...serverItems, ...localData];
  }, [localData, myServerBattles, publicServerBattles]);

  const filtered = (merged ?? []).filter(({ attempts }) => {
    if (filter === "all") return true;
    const hasRanked = attempts.some((a) => !a.disqualified);
    if (filter === "active") return !hasRanked || attempts.length === 0;
    return hasRanked;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Battles</h1>
          <p className="text-sm text-muted-foreground">
            Replay a fixed window of history under rules. Compete with yourself
            — or with friends via multiplayer.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create battle
          </Button>
          <UserMenu />
        </div>
      </header>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {merged === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl bg-card/40"
            />
          ))}
        </div>
      ) : merged.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ battle, attempts, source, visibility, startedAt }) => (
            <BattleCard
              key={`${source}-${battle.id}`}
              battle={battle}
              attempts={attempts}
              source={source}
              visibility={visibility}
              startedAt={startedAt}
            />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-sm text-muted-foreground">
              Nothing matches this filter.
            </p>
          )}
        </div>
      )}

      <CreateBattleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void reloadLocal();
        }}
      />
    </main>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        No battles yet
      </p>
      <h2 className="text-2xl font-semibold tracking-tight">
        Create your first battle
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Pick an instrument, a starting balance, a duration, and optional rules.
        Each attempt is a fresh session against the same window.
      </p>
      <Button size="lg" onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" />
        Create battle
      </Button>
    </div>
  );
}
