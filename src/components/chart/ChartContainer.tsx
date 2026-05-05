"use client";

import { useEffect, useRef, useState } from "react";

import { BarAggregator } from "@/lib/data/BarAggregator";
import { getInstrument } from "@/lib/instruments/instruments";
import { useLayoutStore } from "@/stores/layoutStore";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import type { Bar } from "@/types/bar";

import type { ChartProviderFactory, ChartProviderHandle } from "./ChartProvider.types";
import { createLightweightChart } from "./LightweightChartProvider";
import {
  clearPendingOrderLine,
  clearPositionLines,
  drawPendingOrderLine,
  drawPositionLines,
} from "./overlays/PositionLine";
import { PositionDragOverlay } from "./overlays/PositionDragOverlay";
import { PreviewTriggerDrag } from "./overlays/PreviewTriggerDrag";

/**
 * Resolves the active theme tokens at runtime by reading the CSS variables we
 * declared in globals.css and converting them to `rgb()` strings.
 *
 * Why not pass the values through as `hsl(...)`? Lightweight Charts v4's
 * internal color parser does not accept any `hsl(...)` syntax — neither the
 * modern `hsl(H S% L%)` nor the legacy `hsl(H, S%, L%)`. It only handles
 * `#hex`, `rgb()/rgba()`, and named colors. We do the HSL→RGB conversion
 * here, against the raw H/S/L tokens stored in the CSS variables.
 */
function hslTokensToRgbString(tokens: string): string {
  // Tokens look like "220 13% 95%" — split on whitespace, drop "%"s.
  const parts = tokens.trim().split(/\s+/);
  const h = Number(parts[0]) || 0;
  const s = (Number(parts[1]?.replace("%", "")) || 0) / 100;
  const l = (Number(parts[2]?.replace("%", "")) || 0) / 100;

  // Standard HSL→RGB.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function resolveTheme(): {
  background: string;
  textColor: string;
  gridColor: string;
  bullColor: string;
  bearColor: string;
  crosshairColor: string;
  borderColor: string;
} {
  const styles = getComputedStyle(document.documentElement);
  const v = (name: string) => hslTokensToRgbString(styles.getPropertyValue(name));
  return {
    background: v("--background"),
    textColor: v("--foreground"),
    gridColor: v("--border"),
    bullColor: v("--bull"),
    bearColor: v("--bear"),
    crosshairColor: v("--muted-foreground"),
    borderColor: v("--border"),
  };
}

interface ChartContainerProps {
  /** Symbol to render. Used to look up priceDecimals via the instrument registry. */
  symbol: string | null;
  /**
   * v2.2.5α: when present, this chart instance reads its timeframe + scroll-to-latest
   * trigger from `layoutStore.panes[paneIndex]`. Absent for legacy (single-engine) usage —
   * defaults to 1m and ignores the scroll-to-latest signal.
   */
  paneIndex?: number;
  /** Override factory — the v18 swap target plugs in here. Defaults to LightweightChartProvider. */
  providerFactory?: ChartProviderFactory;
  className?: string;
}

/** Convert a "1" / "5" / "1D" resolution string to bar minutes. */
function resolutionToMinutes(r: string): number {
  if (r === "1D") return 1440;
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function ChartContainer({
  symbol,
  paneIndex,
  providerFactory = createLightweightChart,
  className,
}: ChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ChartProviderHandle | null>(null);
  const [hoverBar, setHoverBar] = useState<Bar | null>(null);
  // v2.2.5α: signal to PositionDragOverlay that handleRef.current is now
  // populated. Refs don't trigger re-renders, so the overlay's useEffect
  // would otherwise bail on null handleRef and never re-run when the chart
  // becomes ready. The state flip below makes the dependency reactive.
  const [handleReady, setHandleReady] = useState(false);

  // Mount the chart once on container insertion. Cleanup tears it down.
  useEffect(() => {
    if (!containerRef.current) return;

    const priceDecimals = symbol ? getInstrument(symbol).priceDecimals : 5;
    const handle = providerFactory({
      container: containerRef.current,
      theme: resolveTheme(),
      priceDecimals,
    });
    handleRef.current = handle;
    setHandleReady(true);

    const unsubCrosshair = handle.subscribeCrosshair(({ bar }) => setHoverBar(bar));

    // Push chart pan/zoom into the replay store so the scrubber can render
    // the visible viewport. We update store state directly (not React) and
    // the scrubber reads via getState() in its rAF loop — no re-renders.
    //
    // Per-pane "is the latest bar in view?" derivation: compare the visible
    // range's right edge to the engine's latest visible bar (with a 2-bar
    // tolerance to absorb the rightOffset cushion). Used by ChartPane to
    // hide the Today button when it's not needed.
    const unsubVisibleRange = handle.subscribeVisibleRange((range) => {
      useReplayStore.setState({ visibleRange: range });
      if (paneIndex == null || !symbol || !range) return;
      const engine = useReplayStore.getState().getEngine(symbol);
      const latestBarTime = engine?.getCurrentBar()?.time;
      if (latestBarTime == null) return;
      // tfMin scales the per-bar tolerance for higher timeframes (a 1h chart
      // showing the latest 1h bar is "at latest" if range.to is within ~2
      // bars = 7200s of latestBarTime).
      const tfMin =
        paneIndex == null
          ? 1
          : resolutionToMinutes(
              useLayoutStore.getState().panes[paneIndex]?.timeframe ?? "1",
            );
      const toleranceSec = tfMin * 60 * 2;
      const atLatest = range.to + toleranceSec >= latestBarTime;
      useLayoutStore.getState().setPaneIsAtLatest(paneIndex, atLatest);
    });

    // v2.2.5α: subscribe to THIS pane's symbol's engine, not the globally
    // active one. In multi-pane layouts each ChartContainer gets a different
    // symbol prop; previously every pane would read state.engine (= the
    // focused pane's engine) and render the same data.
    //
    // Aggregation: when paneIndex is provided, the pane's timeframe is read
    // from layoutStore. A per-chart BarAggregator memoizes (timeframe,
    // lastBarTime, sourceBarsRef) → aggregated bars so per-tick re-renders
    // hit the cache. Live-candle convention (D11): the in-progress bar is
    // the LAST aggregated entry; updateBar(latestAggregated) widens its
    // high/low and updates close as more 1m source bars arrive in the same
    // bucket. When the source crosses a bucket boundary, the new in-progress
    // bar becomes the last aggregated entry — same updateBar handles it.
    const aggregator = new BarAggregator();
    const getTimeframeMinutes = (): number => {
      if (paneIndex == null) return 1;
      const tf = useLayoutStore.getState().panes[paneIndex]?.timeframe ?? "1";
      return resolutionToMinutes(tf);
    };

    const seedAndSubscribe = () => {
      if (!symbol) return () => {};
      const engine = useReplayStore.getState().getEngine(symbol);
      if (!engine) return () => {};
      const tfMin = getTimeframeMinutes();
      const aggregated = aggregator.aggregate(engine.getVisibleBars(), tfMin);
      handle.setData(aggregated);
      // v2.2.5α: prime the price-scale layout. Lightweight Charts lazy-
      // initializes the scale until the first `series.update` call, so on
      // initial mount `priceToY` returns null → PositionDragOverlay's rAF
      // hides the entry/TP/SL chips until the first engine bar event
      // unhides them. Re-pushing the last bar via updateBar is a no-op
      // data-wise but forces a paint, which establishes the scale and
      // makes overlays render immediately.
      const lastSeed = aggregated[aggregated.length - 1];
      if (lastSeed) handle.updateBar(lastSeed);
      return engine.subscribe((event) => {
        if (event.type === "bar") {
          if (tfMin === 1) {
            handle.updateBar(event.bar);
          } else {
            // Re-aggregate; the cache hits unless lastBarTime / sourceBarsRef
            // changed. Update with the latest (in-progress) aggregated bar.
            const next = aggregator.aggregate(engine.getVisibleBars(), tfMin);
            const last = next[next.length - 1];
            if (last) handle.updateBar(last);
          }
        } else if (event.type === "seek" || event.type === "load") {
          // Re-seed: a seek can move backward, which our updateBar guard rejects
          // (intentionally — the chart's setData is the right tool for this).
          aggregator.invalidate(tfMin);
          const next = aggregator.aggregate(engine.getVisibleBars(), tfMin);
          handle.setData(next);
        }
      });
    };

    let unsubEngine = seedAndSubscribe();

    // Re-subscribe when the engines map changes (initEnginesMulti rebuilds it).
    const unsubStore = useReplayStore.subscribe((state, prev) => {
      if (state.engines !== prev.engines) {
        unsubEngine();
        unsubEngine = seedAndSubscribe();
      }
    });

    // Re-seed when this pane's timeframe changes. Drops the aggregator's
    // prior-tf cache entry and aggregates fresh.
    let lastTfMin = getTimeframeMinutes();
    const unsubLayout =
      paneIndex == null
        ? () => {}
        : useLayoutStore.subscribe((state) => {
            const tf = state.panes[paneIndex]?.timeframe ?? "1";
            const tfMin = resolutionToMinutes(tf);
            if (tfMin !== lastTfMin) {
              lastTfMin = tfMin;
              const engine = useReplayStore.getState().getEngine(symbol ?? "");
              if (engine) {
                aggregator.clear();
                handle.setData(aggregator.aggregate(engine.getVisibleBars(), tfMin));
              }
            }
          });

    // Per-pane scroll-to-latest signal: when `requestScrollToLatest(paneIndex)`
    // is called from the ChartPane button, the pane's epoch counter bumps and
    // we tell the chart to snap to the right edge.
    const unsubScroll =
      paneIndex == null
        ? () => {}
        : useLayoutStore.subscribe((state, prev) => {
            const cur = state.scrollToLatestEpoch[paneIndex] ?? 0;
            const old = prev.scrollToLatestEpoch[paneIndex] ?? 0;
            if (cur !== old) handleRef.current?.scrollToLatestBar();
          });

    // Position + pending-order price lines. Subscribe to orderStore and
    // diff: anything in the new state gets upserted; anything dropped gets
    // removed. Cheap because lightweight-charts price-line updates are O(1).
    //
    // Limitation: the lines are static (canvas-rendered, not draggable).
    // Drag-to-modify TP/SL is a TradingView Trading Platform feature; users
    // adjust TP/SL via the position row UI in the meantime. See spec §18.
    const lastPositionIds = new Set<string>();
    const lastOrderIds = new Set<string>();

    const syncOverlays = () => {
      const { openPositions, pendingOrders } = useOrderStore.getState();
      const filterForSymbol = (sym?: string) =>
        symbol ? sym === symbol : true;

      const currentPositionIds = new Set<string>();
      for (const p of openPositions) {
        if (!filterForSymbol(p.instrument)) continue;
        drawPositionLines(handle, p);
        currentPositionIds.add(p.id);
      }
      // Clean up positions that are gone (closed).
      for (const id of lastPositionIds) {
        if (!currentPositionIds.has(id)) {
          // Remove via stub Position — only id is read by clearPositionLines.
          clearPositionLines(handle, {
            id,
            sessionId: "",
            instrument: "",
            side: "buy",
            size: 0,
            entryPrice: 0,
            entryTime: 0,
            unrealizedPnl: 0,
            realizedPnl: 0,
            commission: 0,
            status: "closed",
          });
        }
      }
      lastPositionIds.clear();
      currentPositionIds.forEach((id) => lastPositionIds.add(id));

      const currentOrderIds = new Set<string>();
      for (const o of pendingOrders) {
        if (!filterForSymbol(o.instrument)) continue;
        if (o.type === "market") continue; // market orders don't have a trigger line
        drawPendingOrderLine(handle, o);
        currentOrderIds.add(o.id);
      }
      for (const id of lastOrderIds) {
        if (!currentOrderIds.has(id)) {
          clearPendingOrderLine(handle, {
            id,
            sessionId: "",
            instrument: "",
            side: "buy",
            type: "limit",
            size: 0,
            status: "cancelled",
            createdAt: 0,
          });
        }
      }
      lastOrderIds.clear();
      currentOrderIds.forEach((id) => lastOrderIds.add(id));
    };

    syncOverlays();
    const unsubOrders = useOrderStore.subscribe(syncOverlays);

    // v2.2.5α: pre-trade SL preview. QuickBuySellPanel writes a dotted
    // long/short SL pair to layoutStore as the user types; this draws them
    // (or removes them) on the matching pane's chart. Removing every
    // tick covers the "user cleared the input" case.
    const SL_PREVIEW_LONG_ID = "sl-preview-long";
    const SL_PREVIEW_SHORT_ID = "sl-preview-short";
    const TP_PREVIEW_LONG_ID = "tp-preview-long";
    const TP_PREVIEW_SHORT_ID = "tp-preview-short";
    const TRIGGER_PREVIEW_ID = "trigger-preview";
    const syncSlPreview = () => {
      const preview = useLayoutStore.getState().slPreview;
      if (!preview || preview.symbol !== symbol) {
        handle.removePriceLine(SL_PREVIEW_LONG_ID);
        handle.removePriceLine(SL_PREVIEW_SHORT_ID);
        handle.removePriceLine(TP_PREVIEW_LONG_ID);
        handle.removePriceLine(TP_PREVIEW_SHORT_ID);
        handle.removePriceLine(TRIGGER_PREVIEW_ID);
        return;
      }
      // Trigger preview line for limit/stop orders. Renders in muted gray
      // — visually distinct from the green TP / red SL pairs.
      if (preview.triggerPrice !== undefined && preview.triggerKind) {
        handle.upsertPriceLine({
          id: TRIGGER_PREVIEW_ID,
          price: preview.triggerPrice,
          color: "#8A8C91",
          lineStyle: "dashed",
          lineWidth: 1,
          // Title omitted: the draggable chip from PreviewTriggerDrag already
          // labels the line. Setting one duplicates the text on the price axis.
          title: "",
        });
      } else {
        handle.removePriceLine(TRIGGER_PREVIEW_ID);
      }
      // SL preview pair — only render when the user has actually set an
      // SL distance. Undefined fields mean "no SL on this preview"; we
      // remove any stale lines from a prior render.
      if (preview.longPrice !== undefined) {
        handle.upsertPriceLine({
          id: SL_PREVIEW_LONG_ID,
          price: preview.longPrice,
          color: "#EA3943",
          lineStyle: "dotted",
          lineWidth: 1,
          title: "BUY SL",
        });
      } else {
        handle.removePriceLine(SL_PREVIEW_LONG_ID);
      }
      if (preview.shortPrice !== undefined) {
        handle.upsertPriceLine({
          id: SL_PREVIEW_SHORT_ID,
          price: preview.shortPrice,
          color: "#EA3943",
          lineStyle: "dotted",
          lineWidth: 1,
          title: "SELL SL",
        });
      } else {
        handle.removePriceLine(SL_PREVIEW_SHORT_ID);
      }
      // TP preview pair (green above pivot for BUY TP, below for SELL TP).
      // tpLongPrice is the BUY TP target — above pivot. tpShortPrice is
      // the SELL TP target — below pivot.
      if (preview.tpLongPrice !== undefined) {
        handle.upsertPriceLine({
          id: TP_PREVIEW_LONG_ID,
          price: preview.tpLongPrice,
          color: "#16C784",
          lineStyle: "dotted",
          lineWidth: 1,
          title: "BUY TP",
        });
      } else {
        handle.removePriceLine(TP_PREVIEW_LONG_ID);
      }
      if (preview.tpShortPrice !== undefined) {
        handle.upsertPriceLine({
          id: TP_PREVIEW_SHORT_ID,
          price: preview.tpShortPrice,
          color: "#16C784",
          lineStyle: "dotted",
          lineWidth: 1,
          title: "SELL TP",
        });
      } else {
        handle.removePriceLine(TP_PREVIEW_SHORT_ID);
      }
    };
    syncSlPreview();
    const unsubSlPreview = useLayoutStore.subscribe(syncSlPreview);

    return () => {
      unsubCrosshair();
      unsubVisibleRange();
      unsubEngine();
      unsubStore();
      unsubLayout();
      unsubScroll();
      unsubOrders();
      unsubSlPreview();
      aggregator.clear();
      handle.destroy();
      handleRef.current = null;
      setHandleReady(false);
    };
  }, [providerFactory, symbol, paneIndex]);

  return (
    <div className={className ?? "relative h-full w-full"}>
      <div ref={containerRef} className="h-full w-full" />
      {symbol && (
        <>
          <PositionDragOverlay
            handleRef={handleRef}
            handleReady={handleReady}
            symbol={symbol}
          />
          <PreviewTriggerDrag
            handleRef={handleRef}
            handleReady={handleReady}
            symbol={symbol}
          />
        </>
      )}
      <CrosshairTooltip bar={hoverBar} priceDecimals={symbol ? getInstrument(symbol).priceDecimals : 5} />
    </div>
  );
}

function CrosshairTooltip({
  bar,
  priceDecimals,
}: {
  bar: Bar | null;
  priceDecimals: number;
}) {
  if (!bar) return null;
  const fmt = (n: number) => n.toFixed(priceDecimals);
  const time = new Date(bar.time * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  return (
    <div
      // v2.2.5α: shifted from top-3 to top-12 so it sits below the
      // PaneInstrumentSelector chip (top-2, ~22px tall) in multi-pane mode.
      // Non-pane (legacy) usage of ChartContainer still has free space above.
      className="pointer-events-none absolute left-3 top-12 z-10 rounded-md border border-border bg-card/90 px-3 py-2 font-mono text-xs leading-tight backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="text-muted-foreground">{time}</div>
      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-foreground">
        <span className="text-muted-foreground">O</span><span>{fmt(bar.open)}</span>
        <span className="text-muted-foreground">H</span><span>{fmt(bar.high)}</span>
        <span className="text-muted-foreground">L</span><span>{fmt(bar.low)}</span>
        <span className="text-muted-foreground">C</span><span>{fmt(bar.close)}</span>
      </div>
    </div>
  );
}
