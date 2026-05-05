import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LineWidth,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import type { Bar } from "@/types/bar";

import type {
  ChartLineStyle,
  ChartPriceLineOptions,
  ChartProviderFactory,
  ChartProviderHandle,
  CrosshairListener,
} from "./ChartProvider.types";

/**
 * Lightweight Charts v4 implementation of `ChartProviderHandle`. Owns the
 * chart instance, the candlestick series, and a registry of price lines keyed
 * by stable id. All I/O goes through the handle methods — consumers don't
 * import lightweight-charts directly.
 */

const lineStyleMap: Record<ChartLineStyle, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

function toCandle(bar: Bar): CandlestickData<Time> {
  return {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  };
}

export const createLightweightChart: ChartProviderFactory = ({
  container,
  theme,
  priceDecimals,
}) => {
  // Theme tokens read at mount; live theme switching deferred to Phase 6.
  const chart: IChartApi = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: theme.background },
      textColor: theme.textColor,
      fontFamily:
        "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    },
    grid: {
      vertLines: { color: theme.gridColor },
      horzLines: { color: theme.gridColor },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: theme.crosshairColor, labelBackgroundColor: theme.borderColor },
      horzLine: { color: theme.crosshairColor, labelBackgroundColor: theme.borderColor },
    },
    rightPriceScale: { borderColor: theme.borderColor },
    timeScale: {
      borderColor: theme.borderColor,
      timeVisible: true,
      secondsVisible: false,
      // v2.2.5α: trailing space between the latest bar and the right price
      // scale. Applies to all scroll positions (auto-fit, scrollToRealTime,
      // user pan-to-end). Without this, candles butt up against the price
      // axis labels, which read as cramped.
      rightOffset: 12,
    },
  });

  const series: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
    upColor: theme.bullColor,
    downColor: theme.bearColor,
    borderUpColor: theme.bullColor,
    borderDownColor: theme.bearColor,
    wickUpColor: theme.bullColor,
    wickDownColor: theme.bearColor,
    priceFormat: {
      type: "price",
      precision: priceDecimals ?? 2,
      minMove: priceDecimals ? 1 / 10 ** priceDecimals : 0.01,
    },
  });

  const priceLines = new Map<string, IPriceLine>();
  let lastBarTime = -Infinity;

  const handle: ChartProviderHandle = {
    setData(bars: Bar[]) {
      series.setData(bars.map(toCandle));
      lastBarTime = bars.length > 0 ? bars[bars.length - 1].time : -Infinity;
    },

    updateBar(bar: Bar) {
      // setData seeded the chart up through some bar; if the new bar is BEFORE
      // that, we ignore it (a back-step is handled by re-seeding from
      // ChartContainer). If equal or after, update is correct: the lib treats
      // an equal time as a replacement and a later time as an append.
      if (bar.time < lastBarTime) return;
      series.update(toCandle(bar));
      if (bar.time > lastBarTime) lastBarTime = bar.time;
    },

    upsertPriceLine(opts: ChartPriceLineOptions) {
      const existing = priceLines.get(opts.id);
      const lineWidth = (opts.lineWidth ?? 1) as LineWidth;
      const lineStyle = lineStyleMap[opts.lineStyle];
      if (existing) {
        existing.applyOptions({
          price: opts.price,
          color: opts.color,
          lineStyle,
          lineWidth,
          title: opts.title ?? "",
        });
        return;
      }
      const line = series.createPriceLine({
        price: opts.price,
        color: opts.color,
        lineStyle,
        lineWidth,
        axisLabelVisible: true,
        title: opts.title ?? "",
      });
      priceLines.set(opts.id, line);
    },

    removePriceLine(id: string) {
      const line = priceLines.get(id);
      if (line) {
        series.removePriceLine(line);
        priceLines.delete(id);
      }
    },

    subscribeCrosshair(listener: CrosshairListener) {
      const handler = (param: MouseEventParams) => {
        const data = param.seriesData.get(series) as CandlestickData<Time> | undefined;
        if (!data || param.time === undefined) {
          listener({ bar: null });
          return;
        }
        listener({
          bar: {
            time: data.time as number,
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            // volume isn't in CandlestickData; consumers can look it up by time if needed
            volume: 0,
          },
        });
      };
      chart.subscribeCrosshairMove(handler);
      return () => chart.unsubscribeCrosshairMove(handler);
    },

    resize() {
      // autoSize: true handles container resizes natively. This hook exists
      // for future TV-Trading-Platform compatibility (which lacks autoSize).
    },

    priceToY(price: number): number | null {
      const y = series.priceToCoordinate(price);
      return y === null ? null : y;
    },

    yToPrice(y: number): number | null {
      const p = series.coordinateToPrice(y);
      return p === null ? null : (p as number);
    },

    subscribeVisibleRange(listener) {
      const ts = chart.timeScale();
      const handler = (range: { from: Time; to: Time } | null) => {
        if (!range) {
          listener(null);
          return;
        }
        listener({
          from: range.from as number,
          to: range.to as number,
        });
      };
      ts.subscribeVisibleTimeRangeChange(handler);
      // Fire once with the current range so subscribers don't have to wait
      // for the first user interaction.
      const initial = ts.getVisibleRange();
      handler(initial);
      return () => ts.unsubscribeVisibleTimeRangeChange(handler);
    },

    scrollToLatestBar() {
      // Lightweight Charts' built-in jump-to-realtime. Resets the visible
      // range so the most recent bar sits at the right edge with the
      // library's default trailing offset.
      chart.timeScale().scrollToRealTime();
    },

    destroy() {
      priceLines.clear();
      chart.remove();
    },
  };

  return handle;
};
