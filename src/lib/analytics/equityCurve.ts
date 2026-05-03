import type { Trade } from "@/types/trade";

export interface EquityPoint {
  /** Unix seconds (exitTime). */
  time: number;
  /** Cumulative realized P&L up to and including this point. */
  cumulativePnl: number;
  /** Per-bucket realized P&L (sum of all trades closed at this exit time). */
  pnlAtPoint: number;
  /** How many trades closed at this exact exit time. */
  tradesAtPoint: number;
}

/**
 * Build a per-trade equity curve, anchored at zero before any trades.
 *
 * Trades that close at the same `exitTime` (e.g. multiple positions hit TP
 * on the same bar) are AGGREGATED into a single equity-jump data point
 * per Phase 7 D2 heads-up. The combined cumulative jump represents the
 * actual equity change at that moment.
 *
 * Empty input → empty array. Caller renders "No trades yet" UI in that
 * case rather than a chart with one zero point.
 */
export function buildEquityCurve(trades: Trade[]): EquityPoint[] {
  if (trades.length === 0) return [];

  // Group by exitTime — Map preserves insertion order for traversal but
  // we sort first so equal-time groups end up adjacent.
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  const buckets = new Map<number, { pnl: number; count: number }>();
  for (const t of sorted) {
    const bucket = buckets.get(t.exitTime);
    if (bucket) {
      bucket.pnl += t.pnl;
      bucket.count += 1;
    } else {
      buckets.set(t.exitTime, { pnl: t.pnl, count: 1 });
    }
  }

  let cumulative = 0;
  const points: EquityPoint[] = [];
  for (const [time, { pnl, count }] of buckets) {
    cumulative += pnl;
    points.push({
      time,
      cumulativePnl: cumulative,
      pnlAtPoint: pnl,
      tradesAtPoint: count,
    });
  }
  return points;
}

/**
 * Group trade pnls into N evenly-sized buckets across the [min, max] range
 * for a histogram. Each output bucket carries the count of trades whose pnl
 * falls in [bucket.start, bucket.end).
 *
 * Empty input → empty array. Single-trade input → 1-bucket array centered
 * on that trade's pnl so the histogram renders something instead of being
 * blank.
 */
export interface PnlBucket {
  start: number;
  end: number;
  count: number;
  /** Mid-point used as the X-axis label / value. */
  mid: number;
}

export function bucketTradePnls(trades: Trade[], bucketCount = 20): PnlBucket[] {
  if (trades.length === 0) return [];
  const pnls = trades.map((t) => t.pnl);
  const min = Math.min(...pnls);
  const max = Math.max(...pnls);

  // Degenerate case: all trades have the same pnl. One synthetic bucket.
  if (min === max) {
    return [
      {
        start: min - 0.5,
        end: min + 0.5,
        mid: min,
        count: trades.length,
      },
    ];
  }

  const width = (max - min) / bucketCount;
  const out: PnlBucket[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = min + i * width;
    const end = i === bucketCount - 1 ? max + 1e-9 : min + (i + 1) * width;
    out.push({ start, end, mid: (start + end) / 2, count: 0 });
  }
  for (const p of pnls) {
    let idx = Math.floor((p - min) / width);
    if (idx >= bucketCount) idx = bucketCount - 1;
    if (idx < 0) idx = 0;
    out[idx].count += 1;
  }
  return out;
}
