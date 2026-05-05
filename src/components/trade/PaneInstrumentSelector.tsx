"use client";

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layoutStore";

interface PaneInstrumentSelectorProps {
  paneIndex: number;
  /** Active state controls visual emphasis. */
  isActive?: boolean;
  className?: string;
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
          "pointer-events-none flex items-center gap-1 rounded border bg-background/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider backdrop-blur",
          isActive
            ? "border-primary/40 text-foreground"
            : "border-border/40 text-muted-foreground",
          className,
        )}
      >
        {symbol}
        {isActive && <span className="text-primary">●</span>}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1 rounded border bg-background/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider backdrop-blur transition-colors",
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
        {isActive && <span className="text-primary">●</span>}
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
