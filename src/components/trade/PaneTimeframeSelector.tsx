"use client";

import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layoutStore";

interface PaneTimeframeSelectorProps {
  paneIndex: number;
  isActive?: boolean;
  className?: string;
}

const TIMEFRAMES: { label: string; value: string }[] = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "1D" },
];

/**
 * v2.2.5α: per-pane timeframe selector. Compact segmented control rendered
 * top-right of each pane. Updates layoutStore.panes[paneIndex].timeframe;
 * ChartContainer subscribes and re-aggregates via BarAggregator on change.
 */
export function PaneTimeframeSelector({
  paneIndex,
  isActive,
  className,
}: PaneTimeframeSelectorProps) {
  const timeframe = useLayoutStore(
    (s) => s.panes[paneIndex]?.timeframe ?? "1",
  );
  const setPaneTimeframe = useLayoutStore((s) => s.setPaneTimeframe);

  return (
    <div
      // Stop propagation so clicking the selector doesn't shift focus from
      // a different pane (focus only moves on chart-area clicks).
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        "flex items-center gap-px rounded border bg-background/80 p-0.5 font-mono text-[10px] backdrop-blur",
        isActive ? "border-primary/40" : "border-border/40",
        className,
      )}
      role="group"
      aria-label={`Timeframe for pane ${paneIndex + 1}`}
    >
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => setPaneTimeframe(paneIndex, tf.value)}
          className={cn(
            "rounded px-1.5 py-0.5 uppercase tracking-wider transition-colors",
            timeframe === tf.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          aria-pressed={timeframe === tf.value}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
