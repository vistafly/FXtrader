"use client";

// Invite-link landing page. URL: /battles/join/<inviteCode>
//
// Anonymous hits redirect through the auth gate (middleware → /signin
// with ?next=/battles/join/<code>). After successful signin the user
// lands back here. They see the battle's name + rules + a "Join battle"
// button. Click → routes to the battle detail page (/battles/server-<id>).
//
// No "join" mutation per A4 — invite-only access is implicit via
// possession of the invite code. The battle detail page does its own
// auth/visibility check; this page just bridges discovery → entry.
import { useQuery } from "convex/react";
import { ArrowLeft, Globe, Lock, Swords } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";

import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/analytics/stats";
import { buildBattleUrl } from "@/lib/battles/inviteCode";

import { api } from "../../../../../convex/_generated/api";

export default function JoinBattlePage({
  params,
}: {
  params: Promise<{ inviteCode: string }>;
}) {
  const { inviteCode } = use(params);
  const router = useRouter();
  const battle = useQuery(api.battles.getBattleByInviteCode, { inviteCode });

  if (battle === undefined) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
        <div className="h-32 animate-pulse rounded-xl bg-card/40" />
      </main>
    );
  }

  // Defensive: legacy row from before the v2.2 schema rename — treat as
  // expired/invalid. See lobby + detail page for matching guards.
  const isLegacyRow =
    battle !== undefined &&
    battle !== null &&
    (!battle.instruments ||
      battle.instruments.length === 0 ||
      battle.durationMinutes === undefined ||
      battle.maxParticipants === undefined);

  if (battle === null || isLegacyRow) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Invalid or expired
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          This invite link no longer works.
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The battle may have expired (multiplayer battles run for 7 days),
          or the link is incorrect.
        </p>
        <Button asChild className="mt-2">
          <Link href="/battles">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to battles
          </Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <Link
        href="/battles"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Battles
      </Link>
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          You&apos;ve been invited
        </p>
        <div className="flex items-center gap-2">
          <Swords className="h-5 w-5 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">
            {battle.name}
          </h1>
        </div>
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Created by @{battle.createdBySnapshot} ·{" "}
          {battle.visibility === "public" ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="h-3 w-3" /> Public
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> Invite-only
            </span>
          )}
        </p>
      </header>

      <div className="rounded-xl border border-border/80 bg-card/40 p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Battle setup
        </p>
        <ul className="space-y-1 text-sm">
          <li>
            <span className="text-muted-foreground">
              {battle.instruments.length > 1 ? "Instruments:" : "Instrument:"}
            </span>{" "}
            <span className="font-mono">{battle.instruments.join(", ")}</span>
            {battle.instruments.length > 1 && (
              <span className="text-muted-foreground">
                {" "}
                (plays {battle.instruments[0]} in v2.2)
              </span>
            )}
          </li>
          <li>
            <span className="text-muted-foreground">Duration:</span>{" "}
            <span className="font-mono">{battle.durationMinutes} min</span>
          </li>
          <li>
            <span className="text-muted-foreground">Starting balance:</span>{" "}
            <span className="font-mono">
              ${battle.startingBalance.toLocaleString()}
            </span>
          </li>
          <li>
            <span className="text-muted-foreground">Max participants:</span>{" "}
            <span className="font-mono">{battle.maxParticipants}</span>
          </li>
          {battle.rules.profitTargetPct !== undefined && (
            <li>
              <span className="text-muted-foreground">Profit target:</span>{" "}
              <span className="font-mono text-bull">
                +{formatPercent(battle.rules.profitTargetPct)}
              </span>
            </li>
          )}
          {battle.rules.maxDrawdownPct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max drawdown:</span>{" "}
              <span className="font-mono">
                {formatPercent(battle.rules.maxDrawdownPct)}
              </span>
            </li>
          )}
          {battle.rules.maxLossPerTradePct !== undefined && (
            <li>
              <span className="text-muted-foreground">Max loss/trade:</span>{" "}
              <span className="font-mono">
                {formatPercent(battle.rules.maxLossPerTradePct)}
              </span>
            </li>
          )}
          {battle.rules.requireStopLoss && (
            <li className="text-muted-foreground">Stop loss required.</li>
          )}
        </ul>
      </div>

      <Button
        size="lg"
        onClick={() => router.push(buildBattleUrl("server", battle._id))}
      >
        Join battle
      </Button>
    </main>
  );
}
