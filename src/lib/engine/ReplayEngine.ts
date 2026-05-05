import type { Bar } from "@/types/bar";
import type { SpeedSetting } from "@/types/session";

export type ReplayEvent =
  | { type: "load"; totalBars: number; index: number }
  | { type: "bar"; bar: Bar; index: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; index: number }
  | { type: "speed"; speed: SpeedSetting }
  | { type: "end" };

export type ReplaySubscriber = (event: ReplayEvent) => void;

const BASE_INTERVAL_MS = 1000;

/**
 * Spec §5: drives a simulated clock through historical bars and notifies subscribers
 * on each advance. Tick scheduling uses recursive setTimeout so speed changes apply
 * on the *next* tick. Pause lets the in-flight tick complete.
 *
 * The matching engine and the chart both attach via subscribe(); this class never
 * imports them — clean one-way dependency.
 */
export class ReplayEngine {
  private bars: Bar[] = [];
  private currentIndex = 0;
  private speed: SpeedSetting = 1;
  private playing = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private readonly subscribers = new Set<ReplaySubscriber>();
  /**
   * v2.2.5: stable reference to the visible-bars slice. Returned from
   * getVisibleBars() until the index changes. Required so BarAggregator's
   * (timeframe, lastBarTime, sourceBarsRef) cache key produces hits across
   * repeated chart re-renders within the same bar.
   */
  private visibleBarsCache: Bar[] | null = null;

  // ---- Lifecycle ----------------------------------------------------------

  load(bars: Bar[], startIndex = 0): void {
    if (bars.length === 0) {
      throw new Error("ReplayEngine.load: bars array is empty");
    }
    this.cancelTimer();
    this.bars = bars;
    this.currentIndex = clamp(startIndex, 0, bars.length - 1);
    this.invalidateVisibleBarsCache();
    this.playing = false;
    this.emit({
      type: "load",
      totalBars: this.bars.length,
      index: this.currentIndex,
    });
    this.emit({
      type: "bar",
      bar: this.bars[this.currentIndex],
      index: this.currentIndex,
    });
  }

  play(): void {
    if (this.playing) return;
    if (this.bars.length === 0) return;
    if (this.currentIndex >= this.bars.length - 1) return;
    this.playing = true;
    this.emit({ type: "play" });
    this.scheduleNext();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.cancelTimer();
    this.emit({ type: "pause" });
  }

  step(direction: "forward" | "back"): void {
    if (this.bars.length === 0) return;
    if (this.playing) this.pause();

    const next =
      direction === "forward" ? this.currentIndex + 1 : this.currentIndex - 1;
    if (next < 0 || next >= this.bars.length) return;

    this.currentIndex = next;
    this.invalidateVisibleBarsCache();
    this.emit({
      type: "bar",
      bar: this.bars[this.currentIndex],
      index: this.currentIndex,
    });
  }

  setSpeed(speed: SpeedSetting): void {
    if (this.speed === speed) return;
    this.speed = speed;
    this.emit({ type: "speed", speed });
    // Per spec §5: speed changes apply immediately. If a tick is already pending,
    // cancel it and reschedule at the new interval.
    if (this.playing) this.scheduleNext();
  }

  seekToIndex(index: number): void {
    if (this.bars.length === 0) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();

    this.currentIndex = clamp(index, 0, this.bars.length - 1);
    this.invalidateVisibleBarsCache();
    this.emit({ type: "seek", index: this.currentIndex });
    this.emit({
      type: "bar",
      bar: this.bars[this.currentIndex],
      index: this.currentIndex,
    });

    if (wasPlaying && this.currentIndex < this.bars.length - 1) {
      this.play();
    }
  }

  seekToTime(unixSeconds: number): void {
    if (this.bars.length === 0) return;
    const idx = this.bars.findIndex((b) => b.time >= unixSeconds);
    this.seekToIndex(idx === -1 ? this.bars.length - 1 : idx);
  }

  /**
   * v2.2.5: bidirectional seek to the LATEST bar with bar.time <= targetTime.
   * Used by MasterClock so closed-market instruments (no bar at the master
   * clock's current time) stay at the last bar that DID have data, matching
   * the "market state" semantics. Distinct from seekToTime which prefers
   * at-or-after for "I want to start FROM this time" UX.
   *
   * If no bar has time <= target, clamps to the first bar (best available).
   */
  seekToOrBefore(targetTime: number): void {
    if (this.bars.length === 0) return;
    let idx = -1;
    for (let i = 0; i < this.bars.length; i++) {
      if (this.bars[i].time <= targetTime) idx = i;
      else break;
    }
    if (idx === -1) idx = 0;
    this.seekToIndex(idx);
  }

  /**
   * v2.2.5: external drive used by MasterClock to advance N engines in lockstep
   * against a shared market time. Moves currentIndex forward to the latest bar
   * with bar.time <= targetTime. Engines whose data doesn't include a bar at
   * the target time (closed market) simply don't move — their currentIndex
   * stays put and no event is emitted.
   *
   * Forward-only: if targetTime is before the current bar's time, no-op.
   * Independent of play/pause state — passive advancement only.
   * Emits a single "bar" event when the index advances; emits "end" when the
   * advancement reaches the last bar (matching tick() semantics).
   */
  advanceTo(targetTime: number): void {
    if (this.bars.length === 0) return;
    let nextIndex = this.currentIndex;
    for (let i = this.currentIndex + 1; i < this.bars.length; i++) {
      if (this.bars[i].time <= targetTime) {
        nextIndex = i;
      } else {
        break;
      }
    }
    if (nextIndex === this.currentIndex) return;
    this.currentIndex = nextIndex;
    this.invalidateVisibleBarsCache();
    this.emit({
      type: "bar",
      bar: this.bars[this.currentIndex],
      index: this.currentIndex,
    });
    if (this.currentIndex >= this.bars.length - 1) {
      this.emit({ type: "end" });
    }
  }

  // ---- Accessors ----------------------------------------------------------

  getCurrentBar(): Bar | null {
    return this.bars[this.currentIndex] ?? null;
  }

  getFirstBar(): Bar | null {
    return this.bars[0] ?? null;
  }

  getLastBar(): Bar | null {
    return this.bars[this.bars.length - 1] ?? null;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentPrice(): number | null {
    return this.getCurrentBar()?.close ?? null;
  }

  /**
   * Bars from start through and including the current index.
   * Cached (returned by-reference) until currentIndex changes — see
   * `visibleBarsCache`. Required for BarAggregator memoization.
   */
  getVisibleBars(): Bar[] {
    if (this.visibleBarsCache !== null) return this.visibleBarsCache;
    this.visibleBarsCache = this.bars.slice(0, this.currentIndex + 1);
    return this.visibleBarsCache;
  }

  getTotalBars(): number {
    return this.bars.length;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getSpeed(): SpeedSetting {
    return this.speed;
  }

  // ---- Subscription -------------------------------------------------------

  subscribe(fn: ReplaySubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  // ---- Internal -----------------------------------------------------------

  private scheduleNext(): void {
    this.cancelTimer();
    const intervalMs = BASE_INTERVAL_MS / this.speed;
    this.timerId = setTimeout(() => {
      this.tick();
    }, intervalMs);
  }

  private tick(): void {
    if (!this.playing) return;
    if (this.currentIndex >= this.bars.length - 1) {
      this.playing = false;
      this.emit({ type: "end" });
      return;
    }
    this.currentIndex += 1;
    this.invalidateVisibleBarsCache();
    this.emit({
      type: "bar",
      bar: this.bars[this.currentIndex],
      index: this.currentIndex,
    });
    if (this.currentIndex >= this.bars.length - 1) {
      this.playing = false;
      this.emit({ type: "end" });
      return;
    }
    this.scheduleNext();
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private emit(event: ReplayEvent): void {
    for (const sub of this.subscribers) sub(event);
  }

  private invalidateVisibleBarsCache(): void {
    this.visibleBarsCache = null;
  }

  /**
   * v2.2.5: explicit teardown for MasterClock.disposeEngines(). Clears the
   * timer if any, drops subscribers, drops bars + cache. After dispose() the
   * engine should not be used.
   */
  dispose(): void {
    this.cancelTimer();
    this.playing = false;
    this.subscribers.clear();
    this.bars = [];
    this.visibleBarsCache = null;
    this.currentIndex = 0;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
