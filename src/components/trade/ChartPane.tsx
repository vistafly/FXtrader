"use client";

import { useEffect, useRef, useState } from "react";

import { Clock } from "lucide-react";

import { ChartContainer } from "@/components/chart/ChartContainer";
import { ErrorBoundary } from "@/components/ErrorFallback";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/stores/layoutStore";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";

import { PaneInstrumentSelector } from "./PaneInstrumentSelector";
import { PaneTimeframeSelector } from "./PaneTimeframeSelector";

/** Idle window before the timeframe selector fades out. Matches the legacy
 *  global selector's TF_IDLE_MS so the muscle memory is the same. */
const TF_IDLE_MS = 2000;

interface ChartPaneProps {
  paneIndex: number;
  symbol: string;
  className?: string;
}

/**
 * v2.2.5α: a single pane wrapping ChartContainer with a focus chrome.
 *
 * - Click anywhere in the pane → focus moves to this pane (D9).
 * - The active pane's `replayStore.activeInstrument` mirrors `paneIndex`'s
 *   instrument so order placement routes correctly.
 * - 5α: instrument + timeframe are fixed (auto-derived from
 *   battle.instruments[paneIndex]). 5β replaces this with selectable
 *   dropdowns and per-pane drawing tools.
 */
export function ChartPane({
  paneIndex,
  symbol,
  className,
}: ChartPaneProps) {
  const activePaneIndex = useLayoutStore((s) => s.activePaneIndex);
  const setActivePane = useLayoutStore((s) => s.setActivePane);
  const requestScrollToLatest = useLayoutStore((s) => s.requestScrollToLatest);
  // Whether the pane's latest bar is currently in view. Driven from
  // ChartContainer's visible-range subscription. Defaults true (chart starts
  // anchored to the right edge). Today button hides when true.
  const isAtLatest = useLayoutStore(
    (s) => s.paneIsAtLatest[paneIndex] ?? true,
  );
  const isActive = activePaneIndex === paneIndex;

  // v2.2.6a: per-pane open-position count. Zustand selector returns a primitive
  // number so re-renders are scoped to count changes only.
  const positionCount = useOrderStore(
    (s) => s.openPositions.filter((p) => p.instrument === symbol).length,
  );

  // Auto-fade timeframe selector on idle. Visible by default; resets on
  // mouse move within the pane. Matches the legacy global selector's
  // pattern so users don't relearn the affordance.
  const [tfVisible, setTfVisible] = useState(true);
  const tfHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimeframe = () => {
    setTfVisible(true);
    if (tfHideTimerRef.current) clearTimeout(tfHideTimerRef.current);
    tfHideTimerRef.current = setTimeout(() => setTfVisible(false), TF_IDLE_MS);
  };
  useEffect(() => {
    // Initial idle-hide schedule (don't bump state synchronously here —
    // tfVisible already starts true). Subsequent activity uses pingTimeframe.
    tfHideTimerRef.current = setTimeout(
      () => setTfVisible(false),
      TF_IDLE_MS,
    );
    return () => {
      if (tfHideTimerRef.current) clearTimeout(tfHideTimerRef.current);
    };
  }, []);

  // Sync replayStore.activeInstrument when this pane becomes active. Without
  // this sync, orderStore would keep routing to the previously active pane's
  // instrument.
  const syncedRef = useRef(false);
  useEffect(() => {
    if (!isActive) {
      syncedRef.current = false;
      return;
    }
    const replay = useReplayStore.getState();
    if (replay.activeInstrument !== symbol) {
      replay.setActiveInstrument(symbol);
    }
    syncedRef.current = true;
  }, [isActive, symbol]);

  return (
    <div
      onMouseDown={() => {
        if (!isActive) setActivePane(paneIndex);
      }}
      onMouseMove={pingTimeframe}
      onPointerDown={pingTimeframe}
      className={cn(
        "relative flex flex-col overflow-hidden border bg-background transition-colors",
        isActive
          ? "border-primary/70 shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
          : "border-border/40 hover:border-border",
        className,
      )}
    >
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <PaneInstrumentSelector paneIndex={paneIndex} isActive={isActive} />
        {/* v2.2.6a: position-count badge. Hidden at zero; subtle fade-in
            on 0→1+ via opacity transition. Sits adjacent to the
            instrument selector so the user can see at a glance which
            pane carries which positions in a multi-pane workspace. */}
        <div
          className={cn(
            "pointer-events-none flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-1 font-mono text-[10px] font-semibold tabular-nums transition-opacity duration-200",
            positionCount > 0 ? "opacity-100" : "opacity-0",
            isActive
              ? "border-primary/50 bg-primary/15 text-primary"
              : "border-border/50 bg-background/80 text-muted-foreground",
          )}
          aria-label={
            positionCount > 0
              ? `${positionCount} open position${positionCount === 1 ? "" : "s"} on ${symbol}`
              : undefined
          }
          aria-hidden={positionCount === 0}
        >
          {positionCount}
        </div>
      </div>
      <ErrorBoundary
        label={`Chart ${symbol}`}
        hint="Failed to render this pane. Try selecting a different layout."
        className="absolute inset-0"
      >
        <ChartContainer
          symbol={symbol}
          paneIndex={paneIndex}
          className="h-full w-full"
        />
      </ErrorBoundary>
      {/* v2.2.5α: timeframe selector — just above the chart's time-axis
          strip. bottom-9 (36px) keeps it close to the bottom but with
          enough gap that the time labels aren't hidden behind it.
          Auto-fades on idle. */}
      <div
        className={cn(
          "absolute bottom-9 left-1/2 z-10 -translate-x-1/2 transition-opacity duration-300",
          tfVisible ? "opacity-100" : "opacity-0",
        )}
        onMouseEnter={pingTimeframe}
      >
        <PaneTimeframeSelector paneIndex={paneIndex} isActive={isActive} />
      </div>
      {/* Jump-to-today button. Bottom-right, offset inward (right-16) so it
          clears Lightweight Charts' right price scale. Hidden when the
          latest bar is already in view (isAtLatest, derived from the chart's
          visible-range subscription) — only appears when the user has
          scrolled into the past and needs to jump forward. */}
      {!isAtLatest && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => requestScrollToLatest(paneIndex)}
          className={cn(
            // Sits between the chart's time-axis strip and the timeframe
            // selector (which is at bottom-9). right-16 clears the right
            // price scale.
            "absolute bottom-7 right-16 z-10 inline-flex items-center gap-1 rounded border bg-background/80 px-2 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur transition-colors",
            isActive
              ? "border-primary/40 text-foreground hover:bg-background"
              : "border-border/40 text-muted-foreground hover:border-border hover:text-foreground",
          )}
          aria-label="Jump to latest bar"
          title="Jump to latest bar"
        >
          <Clock className="h-3 w-3" />
          Today
        </button>
      )}
    </div>
  );
}
