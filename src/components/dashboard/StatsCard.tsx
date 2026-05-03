import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  /** Optional sub-label rendered below the value, smaller. */
  hint?: string;
  /** Tint the value text — e.g. for P&L. */
  accent?: "bull" | "bear" | "neutral";
}

export function StatsCard({
  icon: Icon,
  label,
  value,
  hint,
  accent = "neutral",
}: StatsCardProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card/50 p-4 transition-colors hover:bg-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-2 font-mono text-2xl font-bold tabular-nums leading-none",
          accent === "bull" && "text-bull",
          accent === "bear" && "text-bear",
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}
