"use client";

import { useMemo, useRef } from "react";

import { useLayoutStore } from "@/stores/layoutStore";

import { ChartPane } from "./ChartPane";

/**
 * v2.2.5α: grid container that renders one ChartPane per layout slot, with
 * drag-to-resize splitters between adjacent panes.
 *
 * Track sizes derive from layoutStore.gridSplits — fractional positions of
 * splitters along each axis. Splitter overlays are absolute-positioned divs
 * that capture pointer drags and translate them to fraction updates.
 *
 * Layouts:
 *   - "1pane"        — single chart fills container, no splitters
 *   - "2vertical"    — top/bottom split,    1 horizontal splitter
 *   - "2horizontal"  — left/right split,    1 vertical splitter
 *   - "4quad"        — 2×2,                 1 vertical + 1 horizontal splitter
 *   - "6pane"        — 3×2,                 2 vertical + 1 horizontal splitter
 */
export function ChartGrid() {
  const panes = useLayoutStore((s) => s.panes);
  const splits = useLayoutStore((s) => s.gridSplits);
  const setGridSplit = useLayoutStore((s) => s.setGridSplit);

  const containerRef = useRef<HTMLDivElement>(null);

  // Convert splitter positions → grid-template tracks. Each track's size is
  // the gap between consecutive splitter positions (with implicit 0 and 1
  // endpoints), expressed in fr units that grid auto-distributes.
  const colTemplate = useMemo(
    () => fractionsToFrTracks(splits.cols),
    [splits.cols],
  );
  const rowTemplate = useMemo(
    () => fractionsToFrTracks(splits.rows),
    [splits.rows],
  );

  if (panes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Initializing layout…
      </div>
    );
  }

  const onSplitterDrag = (
    axis: "cols" | "rows",
    index: number,
    e: React.PointerEvent,
  ) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const fraction =
        axis === "cols"
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
      setGridSplit(axis, index, fraction);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    // React 19's react-hooks/immutability flags direct mutation of
    // `document.body.style` from helpers called via curried event handlers.
    // The mutation pattern is intentional (matches the trade page's
    // table-resize handler) — disable the rule for these two lines so they
    // don't trip the lint gate.
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.cursor = axis === "cols" ? "col-resize" : "row-resize";
    // eslint-disable-next-line react-hooks/immutability
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: colTemplate,
          gridTemplateRows: rowTemplate,
        }}
      >
        {panes.map((pane, i) => (
          <ChartPane
            key={`${i}-${pane.instrument}`}
            paneIndex={i}
            symbol={pane.instrument}
          />
        ))}
      </div>

      {/* Vertical splitters (between columns). Hit area is 8px wide, centered
          on the boundary; visible affordance is a 1px line that thickens on
          hover. pointer-events-auto on the wrapper; the grid itself receives
          no interference because splitters sit on top with z-30. */}
      {splits.cols.map((pos, i) => (
        <div
          key={`vsplit-${i}`}
          onPointerDown={(e) => onSplitterDrag("cols", i, e)}
          style={{
            left: `${pos * 100}%`,
            transform: "translateX(-50%)",
          }}
          className="group absolute top-0 bottom-0 z-30 flex w-2 cursor-col-resize items-stretch justify-center"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize columns at boundary ${i + 1}`}
        >
          <div className="w-px bg-border/40 transition-colors group-hover:w-0.5 group-hover:bg-primary/60" />
        </div>
      ))}

      {/* Horizontal splitters (between rows). */}
      {splits.rows.map((pos, i) => (
        <div
          key={`hsplit-${i}`}
          onPointerDown={(e) => onSplitterDrag("rows", i, e)}
          style={{
            top: `${pos * 100}%`,
            transform: "translateY(-50%)",
          }}
          className="group absolute left-0 right-0 z-30 flex h-2 cursor-row-resize items-center justify-stretch"
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize rows at boundary ${i + 1}`}
        >
          <div className="h-px w-full bg-border/40 transition-colors group-hover:h-0.5 group-hover:bg-primary/60" />
        </div>
      ))}
    </div>
  );
}

/**
 * Convert splitter positions (e.g. [0.33, 0.67]) into a grid-template tracks
 * string ("0.33fr 0.34fr 0.33fr"). Implicit 0 and 1 endpoints frame the
 * positions; consecutive differences become track widths.
 */
function fractionsToFrTracks(positions: number[]): string {
  const widths: number[] = [];
  let prev = 0;
  for (const pos of positions) {
    widths.push(Math.max(0.01, pos - prev));
    prev = pos;
  }
  widths.push(Math.max(0.01, 1 - prev));
  return widths.map((w) => `${w}fr`).join(" ");
}
