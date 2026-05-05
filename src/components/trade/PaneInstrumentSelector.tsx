"use client";

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  isMarketOpen,
  nextMarketOpen,
} from "@/lib/instruments/sessionHours";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layoutStore";
import { useReplayStore } from "@/stores/replayStore";

interface PaneInstrumentSelectorProps {
  paneIndex: number;
  /** Active state controls visual emphasis. */
  isActive?: boolean;
  className?: string;
}

/**
 * v2.2.6b: market-status dot. Replaces the prior active-pane blue dot
 * (the active pane is already visually distinct via the chip's border
 * color). Pulled into the selector chip itself so the symbol and its
 * open/closed state read as a single unit.
 *
 * Visual polish: a filled dot with a softer same-color halo ring at
 * low opacity, plus a subtle outer glow shadow. Color transitions
 * smoothly on the open↔closed boundary.
 *
 *   green  → market open
 *   red    → market closed
 *   hidden → no sessionHours preset on the instrument (defensive)
 */
function MarketStatusDot({ symbol }: { symbol: string }) {
  const currentBarTime = useReplayStore((s) => s.currentBarTime);
  const open = symbol ? isMarketOpen(symbol, currentBarTime) : undefined;
  if (open === undefined) return null;

  const next =
    open === false && symbol
      ? nextMarketOpen(symbol, currentBarTime)
      : undefined;
  const title = open
    ? "Market open"
    : next !== undefined
      ? `Market closed — opens ${formatNextOpen(next)}`
      : "Market closed";

  return (
    <span
      className={cn(
        "relative inline-flex h-2 w-2 items-center justify-center transition-colors duration-300",
      )}
      title={title}
      aria-label={title}
    >
      {/* Soft halo — same hue, lower opacity, slightly larger. Gives the
          dot more presence without making it visually heavy. */}
      <span
        className={cn(
          "absolute inset-[-2px] rounded-full transition-colors duration-300",
          open ? "bg-emerald-500/25" : "bg-rose-500/25",
        )}
      />
      {/* Core dot. Inset shadow for depth, outer shadow for glow. */}
      <span
        className={cn(
          "relative h-2 w-2 rounded-full transition-colors duration-300",
          open
            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7),inset_0_-1px_1px_rgba(0,0,0,0.18)]"
            : "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7),inset_0_-1px_1px_rgba(0,0,0,0.18)]",
        )}
      />
    </span>
  );
}

function formatNextOpen(sec: number): string {
  const d = new Date(sec * 1000);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dow} ${hh}:${mm} UTC`;
}

/**
 * v2.2.5α: per-pane instrument dropdown. Shows the pane's current symbol with
 * a chevron; the dropdown lists every instrument the session was opened with
 * (`availableInstruments`). Duplicates are allowed — a user may want EURUSD
 * shown in two panes for multi-timeframe analysis (timeframe per pane is 5β).
 *
 * Uses Zustand selectors directly; the parent ChartPane doesn't pass values
 * through props so a pane swap doesn't force re-renders of unrelated panes.
 */
export function PaneInstrumentSelector({
  paneIndex,
  isActive,
  className,
}: PaneInstrumentSelectorProps) {
  const symbol = useLayoutStore((s) => s.panes[paneIndex]?.instrument ?? "");
  const available = useLayoutStore((s) => s.availableInstruments);
  const setPaneInstrument = useLayoutStore((s) => s.setPaneInstrument);

  // Single-instrument session — show as a static label, no dropdown affordance.
  if (available.length <= 1) {
    return (
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded border bg-background/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider backdrop-blur",
          isActive
            ? "border-primary/40 text-foreground"
            : "border-border/40 text-muted-foreground",
          className,
        )}
      >
        {symbol}
        <MarketStatusDot symbol={symbol} />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 rounded border bg-background/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider backdrop-blur transition-colors",
          isActive
            ? "border-primary/40 text-foreground hover:bg-background"
            : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
          className,
        )}
        // Stop the click from bubbling up to ChartPane's onMouseDown focus
        // handler — opening the dropdown shouldn't shift focus to a different
        // pane (focus stays where it is, which matters for U3 dialog UX).
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={`Select instrument for pane ${paneIndex + 1}`}
      >
        {symbol}
        <MarketStatusDot symbol={symbol} />
        <ChevronDown className="h-2.5 w-2.5 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {available.map((sym) => (
          <DropdownMenuItem
            key={sym}
            onSelect={() => setPaneInstrument(paneIndex, sym)}
            className={cn(
              "font-mono text-[11px] uppercase tracking-wider",
              sym === symbol && "bg-accent text-foreground",
            )}
          >
            {sym}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
