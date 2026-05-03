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

  // ---- Lifecycle ----------------------------------------------------------

  load(bars: Bar[], startIndex = 0): void {
    if (bars.length === 0) {
      throw new Error("ReplayEngine.load: bars array is empty");
    }
    this.cancelTimer();
    this.bars = bars;
    this.currentIndex = clamp(startIndex, 0, bars.length - 1);
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

  /** Bars from start through and including the current index. */
  getVisibleBars(): Bar[] {
    return this.bars.slice(0, this.currentIndex + 1);
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
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
