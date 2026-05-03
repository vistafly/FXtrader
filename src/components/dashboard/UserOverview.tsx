import { Flame, Swords } from "lucide-react";

import { TraderKindBadge } from "@/components/dashboard/TraderKindBadge";
import type { TraderKind } from "@/lib/analytics/trader-kind";

interface Props {
  traderKind: TraderKind;
  battlesCount: number;
  winStreak: number;
  totalSessions: number;
}

/**
 * Hero strip rendered at the top of the dashboard. Shows the user's
 * "trader kind" classification plus battles count and win streak — the
 * gamified summary line that defines the dashboard's identity.
 */
export function UserOverview({
  traderKind,
  battlesCount,
  winStreak,
  totalSessions,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border/80 bg-card/40 p-5">
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Trader profile
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            FXTrader
          </h2>
          <TraderKindBadge kind={traderKind} />
        </div>
        <p className="text-xs text-muted-foreground">
          {totalSessions === 0
            ? "No sessions yet — start your first to begin building stats."
            : `${totalSessions} ${totalSessions === 1 ? "session" : "sessions"} on record`}
        </p>
      </div>

      <div className="flex items-center gap-5">
        <Metric
          icon={<Swords className="h-4 w-4 text-primary" />}
          value={battlesCount.toString()}
          label="Battles"
        />
        <Metric
          icon={<Flame className="h-4 w-4 text-orange-500" />}
          value={winStreak === 0 ? "—" : winStreak.toString()}
          label="Win streak"
          hint={winStreak >= 3 ? "🔥" : undefined}
        />
      </div>
    </div>
  );
}

function Metric({
  icon,
  value,
  label,
  hint,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex min-w-[90px] flex-col items-center gap-0.5">
      <div className="flex items-baseline gap-1">
        {icon}
        <span className="font-mono text-2xl font-bold tabular-nums leading-none text-foreground">
          {value}
        </span>
        {hint && <span className="text-sm">{hint}</span>}
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
