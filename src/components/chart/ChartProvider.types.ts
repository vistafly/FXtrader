/**
 * Chart provider abstraction. Per spec §2 future-proofing constraint and §18,
 * this is the seam that lets us swap Lightweight Charts → TradingView Trading
 * Platform library without touching consumers.
 *
 * The interface is intentionally narrow: enough for our app's needs (render
 * candles, push bar updates, draw position price lines, react to crosshair
 * hover), nothing chart-library-specific.
 */

import type { Bar } from "@/types/bar";

export type ChartLineStyle = "solid" | "dashed" | "dotted";

export interface ChartPriceLineOptions {
  /** Stable id used to update or remove a previously-drawn line. */
  id: string;
  price: number;
  color: string;
  lineStyle: ChartLineStyle;
  /** Short label rendered next to the line on the price axis. */
  title?: string;
  /** Width in pixels (1–4). Defaults to 1. */
  lineWidth?: 1 | 2 | 3 | 4;
}

export interface CrosshairPayload {
  /** null when the crosshair leaves the chart area. */
  bar: Bar | null;
}

export type CrosshairListener = (payload: CrosshairPayload) => void;

export interface ChartProviderHandle {
  /** Replace the entire series. Used when seeding the chart on first load. */
  setData(bars: Bar[]): void;

  /** Append-or-update a single bar. Used for replay ticks. Idempotent for the same time. */
  updateBar(bar: Bar): void;

  /** Insert or update a horizontal price line. Identified by `options.id`. */
  upsertPriceLine(options: ChartPriceLineOptions): void;

  /** Remove a price line by id. No-op if not present. */
  removePriceLine(id: string): void;

  /** Subscribe to crosshair-move events. Returns an unsubscribe fn. */
  subscribeCrosshair(listener: CrosshairListener): () => void;

  /** Resize to fit current container dimensions. Called on parent layout changes. */
  resize(): void;

  /**
   * Convert a price into a Y pixel coordinate (relative to the chart's content
   * area). Returns null when the price is outside the visible range or the
   * chart isn't ready. Used by the drag-handle overlay.
   */
  priceToY(price: number): number | null;

  /** Inverse of priceToY. Returns null if the chart isn't ready. */
  yToPrice(y: number): number | null;

  /**
   * Subscribe to changes in the chart's visible time range (pan / zoom).
   * Listener gets called with `{ from, to }` in Unix seconds, or null when
   * the chart has no data yet. Returns an unsubscribe function.
   */
  subscribeVisibleRange(
    listener: (range: { from: number; to: number } | null) => void,
  ): () => void;

  /**
   * v2.2.5α: scroll the visible range to the right edge (latest bar). Used by
   * the per-pane "Go to today" jump button when the user has panned far back
   * in history and wants to snap to the playhead.
   */
  scrollToLatestBar(): void;

  /** Tear down the underlying chart instance. Caller must drop the handle. */
  destroy(): void;
}

export interface CreateChartOptions {
  /** DOM node to mount the chart into. Owns its size; chart fills 100%. */
  container: HTMLElement;
  /** Theme colors. Hex or CSS color strings. */
  theme: {
    background: string;
    textColor: string;
    gridColor: string;
    bullColor: string;
    bearColor: string;
    crosshairColor: string;
    borderColor: string;
  };
  /** Price decimals — drives axis formatter. Falls back to 2 if omitted. */
  priceDecimals?: number;
}

export type ChartProviderFactory = (opts: CreateChartOptions) => ChartProviderHandle;
