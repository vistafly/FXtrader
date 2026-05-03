import type { Bar } from "@/types/bar";

/**
 * Deterministic 100-bar fixture used by the engine tests. Seeded LCG → bars are
 * stable across runs. Don't use for visual verification; just for engine plumbing.
 */
export function makeSampleBars(count = 100, startTime = 1_700_000_000): Bar[] {
  let seed = 0xC0FFEE;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  const bars: Bar[] = [];
  let close = 1.1;
  for (let i = 0; i < count; i++) {
    const open = close;
    const drift = (rng() - 0.5) * 0.002; // ±10 pips
    close = +(open + drift).toFixed(5);
    const high = +Math.max(open, close, open + Math.abs(drift) * 0.6).toFixed(5);
    const low = +Math.min(open, close, open - Math.abs(drift) * 0.6).toFixed(5);
    bars.push({
      time: startTime + i * 60,
      open,
      high,
      low,
      close,
      volume: Math.floor(rng() * 1000) + 100,
    });
  }
  return bars;
}
