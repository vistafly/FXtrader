"use client";

import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BattleCard } from "@/components/battles/BattleCard";
import { CreateBattleDialog } from "@/components/battles/CreateBattleDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { battleRepository } from "@/lib/repository/BattleRepository";
import type { Battle, BattleAttempt } from "@/types/battle";

type FilterTab = "active" | "completed" | "all";

interface BattleWithAttempts {
  battle: Battle;
  attempts: BattleAttempt[];
}

export default function BattlesLobbyPage() {
  const [data, setData] = useState<BattleWithAttempts[] | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const reload = async () => {
    const battles = await battleRepository.listBattles();
    const withAttempts: BattleWithAttempts[] = await Promise.all(
      battles.map(async (battle) => ({
        battle,
        attempts: await battleRepository.listAttempts(battle.id),
      })),
    );
    setData(withAttempts);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const battles = await battleRepository.listBattles();
      const withAttempts: BattleWithAttempts[] = await Promise.all(
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

  const filtered = (data ?? []).filter(({ attempts }) => {
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
            href="/"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Battles</h1>
          <p className="text-sm text-muted-foreground">
            Replay a fixed window of history under rules. Compete with yourself.
          </p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create battle
        </Button>
      </header>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {data === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-card/40" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ battle, attempts }) => (
            <BattleCard key={battle.id} battle={battle} attempts={attempts} />
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
          void reload();
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
      <h2 className="text-2xl font-semibold tracking-tight">Create your first battle</h2>
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
