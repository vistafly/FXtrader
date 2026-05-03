import { cn } from "@/lib/utils";
import type { TraderKind } from "@/lib/analytics/trader-kind";

const STYLE: Record<TraderKind, string> = {
  Scalper: "bg-bull/15 text-bull border-bull/30",
  "Day Trader": "bg-primary/15 text-primary border-primary/30",
  Swing: "bg-secondary/15 text-secondary border-secondary/30",
  "New Trader": "bg-muted text-muted-foreground border-border",
};

export function TraderKindBadge({ kind }: { kind: TraderKind }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider",
        STYLE[kind],
      )}
    >
      {kind}
    </span>
  );
}
