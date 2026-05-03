import type { Bar } from "@/types/bar";

/**
 * Aggregate 1-minute bars into a higher timeframe.
 *
 * Pure function. Buckets by `floor(time / intervalSec) * intervalSec`. Bars in
 * the same bucket are merged (open = first.open, high = max, low = min,
 * close = last.close, volume = sum). Bars are assumed to arrive in ascending
 * time order; the input is not sorted defensively.
 *
 * Session gaps are preserved: if the input is missing minutes (e.g. between
 * Friday close and Sunday open), buckets covering those minutes simply emit
 * no output. The result is a non-contiguous array of higher-timeframe bars
 * with a real time gap between the bracketing entries — exactly what a chart
 * needs to render the gap correctly.
 */
export function aggregateBars(bars: Bar[], timeframeMinutes: number): Bar[] {
  if (!Number.isFinite(timeframeMinutes) || timeframeMinutes <= 0) {
    throw new Error(`aggregateBars: timeframeMinutes must be > 0, got ${timeframeMinutes}`);
  }
  if (timeframeMinutes === 1) return bars.slice();
  if (bars.length === 0) return [];

  const intervalSec = timeframeMinutes * 60;
  const out: Bar[] = [];
  let bucketStart = -1;
  let acc: Bar | null = null;

  for (const b of bars) {
    const bs = Math.floor(b.time / intervalSec) * intervalSec;
    if (bs !== bucketStart) {
      if (acc) out.push(acc);
      bucketStart = bs;
      acc = {
        time: bs,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      };
    } else if (acc) {
      if (b.high > acc.high) acc.high = b.high;
      if (b.low < acc.low) acc.low = b.low;
      acc.close = b.close;
      acc.volume += b.volume;
    }
  }
  if (acc) out.push(acc);
  return out;
}
