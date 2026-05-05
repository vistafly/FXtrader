import { aggregateBars } from "./aggregateBars";
import type { Bar } from "@/types/bar";

/**
 * v2.2.5: per-engine memoized aggregator.
 *
 * D1 spec: "Memoize per (timeframe, lastBarTime, sourceBarsRef). Cache scope
 * is per-engine-instance, not global. Drop cache on engine disposal."
 *
 * The chart re-renders many times per visible bar. Without memoization, a
 * 30-day 1m dataset (~43,200 bars) gets re-aggregated on every render × pane
 * × tick. At 16× speed with a 4-quadrant layout that's hundreds of thousands
 * of bar-ops per second.
 *
 * Cache hits when the same (timeframe, lastBarTime, sourceBarsRef) produces
 * the same output:
 *   - sourceBarsRef: array identity check. ReplayEngine.getVisibleBars()
 *     returns a stable reference until the index changes (cache invalidates
 *     internally on index advance). So calling getVisibleBars() repeatedly
 *     within the same bar produces ref-equal arrays → cache hit.
 *   - lastBarTime: defensive guard against mutation. If the caller mutates
 *     the source array (e.g. updates the last bar's high/low to widen during
 *     a live candle), the lastBarTime is unchanged BUT the cache key still
 *     matches — caller must invalidate manually via .invalidate(). For
 *     normal flow, lastBarTime advancing means a new bar was added → cache
 *     miss → re-aggregate.
 *   - timeframe: separate slot per timeframe.
 *
 * Live-candle convention (D11): the last entry in the aggregated output IS
 * the in-progress higher-timeframe bar. Its high/low/close reflect the
 * accumulated state of all source bars in the current bucket. When the
 * source advances by one minute and lands in the SAME bucket, the in-progress
 * bar's high may widen, low may narrow, close updates. When the source crosses
 * a bucket boundary, a new in-progress bar begins. The chart should call
 * series.update(lastBar) for in-progress updates and series.setData(allBars)
 * only when the timeframe or instrument changes.
 */
export class BarAggregator {
  private cache = new Map<number, { sourceRef: Bar[]; lastBarTime: number; result: Bar[] }>();

  /**
   * Aggregate `source` to the given timeframe (in minutes), with memoization.
   * Returns a stable reference until the cache key invalidates.
   */
  aggregate(source: Bar[], timeframeMinutes: number): Bar[] {
    if (timeframeMinutes <= 0 || !Number.isFinite(timeframeMinutes)) {
      throw new Error(
        `BarAggregator.aggregate: timeframeMinutes must be > 0, got ${timeframeMinutes}`,
      );
    }

    const lastBarTime = source.length === 0 ? 0 : source[source.length - 1].time;
    const cached = this.cache.get(timeframeMinutes);
    if (
      cached &&
      cached.sourceRef === source &&
      cached.lastBarTime === lastBarTime
    ) {
      return cached.result;
    }

    const result = aggregateBars(source, timeframeMinutes);
    this.cache.set(timeframeMinutes, {
      sourceRef: source,
      lastBarTime,
      result,
    });
    return result;
  }

  /**
   * Drop a single timeframe's cache entry. Use after manual mutation of the
   * source bars (rare — most consumers should rely on lastBarTime/ref change).
   */
  invalidate(timeframeMinutes: number): void {
    this.cache.delete(timeframeMinutes);
  }

  /** Drop all cache entries. Called on engine disposal. */
  clear(): void {
    this.cache.clear();
  }

  /** Test-only: how many cache entries are held. */
  size(): number {
    return this.cache.size;
  }
}
