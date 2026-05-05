import type { Bar } from "@/types/bar";
import type { SpeedSetting } from "@/types/session";

import { ReplayEngine, type ReplayEvent, type ReplaySubscriber } from "./ReplayEngine";

const BASE_INTERVAL_MS = 1000;
/** Master tick advances market time by one minute (matching 1m source bars). */
const MASTER_STEP_SEC = 60;

export type MasterClockEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "speed"; speed: SpeedSetting }
  | { type: "seek"; time: number }
  | { type: "end" }
  | { type: "tick"; time: number };

export type MasterClockSubscriber = (event: MasterClockEvent) => void;

export interface InitEnginesParams {
  /** Symbol → bar array (1m timeframe). One ReplayEngine per entry. */
  bars: Map<string, Bar[]>;
  /** Initial market time (Unix seconds). All engines advance to this on init. */
  startTime: number;
}

/**
 * v2.2.5: coordinator for N ReplayEngines under one shared market clock.
 *
 * Each unique instrument has its own engine. The clock owns the timer; on
 * each tick the master `currentTime` advances by 60 seconds and every engine
 * is asked to advance to that time (via engine.advanceTo). Engines whose
 * data has no bar at that moment (e.g. a futures instrument during the CME
 * maintenance break) simply don't move — their currentIndex stays put.
 *
 * Spec: CLAUDE.md §16.1 v2.2.5 D1.
 */
export class MasterClock {
  private engines = new Map<string, ReplayEngine>();
  private currentTime = 0;
  private maxReachedTime = 0;
  private speed: SpeedSetting = 1;
  private playing = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private readonly subscribers = new Set<MasterClockSubscriber>();

  // ---- Lifecycle ----------------------------------------------------------

  /**
   * Instantiate engines for each instrument and seat them at the start time.
   * Called from replayStore.initEngines() when entering a server battle.
   */
  initEngines(params: InitEnginesParams): void {
    this.disposeEngines();
    for (const [symbol, bars] of params.bars) {
      const engine = new ReplayEngine();
      engine.load(bars, 0);
      // Seek each engine forward to the master start time before play begins,
      // so chart history shows bars up to the start.
      engine.seekToTime(params.startTime);
      this.engines.set(symbol, engine);
    }
    this.currentTime = params.startTime;
    this.maxReachedTime = params.startTime;
  }

  /**
   * Tear down. Stops the timer, disposes every engine, clears references.
   * Called on /trade/[sessionId] route unmount, session end, or page nav.
   * After dispose, the clock holds zero engines and zero pending timers.
   */
  disposeEngines(): void {
    this.cancelTimer();
    this.playing = false;
    for (const engine of this.engines.values()) engine.dispose();
    this.engines.clear();
    this.currentTime = 0;
    this.maxReachedTime = 0;
  }

  // ---- Playback control ---------------------------------------------------

  play(): void {
    if (this.playing) return;
    if (this.engines.size === 0) return;
    if (this.allEnginesAtEnd()) return;
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

  setSpeed(speed: SpeedSetting): void {
    if (this.speed === speed) return;
    this.speed = speed;
    this.emit({ type: "speed", speed });
    if (this.playing) this.scheduleNext();
  }

  /**
   * Step the master clock by one bar (= one minute of market time). All
   * engines advance to the new time. Pauses if currently playing.
   */
  step(direction: "forward" | "back"): void {
    if (this.playing) this.pause();
    if (direction === "forward") {
      this.advanceMasterTime(this.currentTime + MASTER_STEP_SEC);
    } else {
      // Backward step is simulated time travel; engines re-emit the bar at
      // the new (earlier) time. Engine.advanceTo is forward-only so backward
      // requires per-engine seekToTime.
      this.currentTime = Math.max(0, this.currentTime - MASTER_STEP_SEC);
      for (const engine of this.engines.values()) {
        engine.seekToOrBefore(this.currentTime);
      }
      this.emit({ type: "seek", time: this.currentTime });
    }
  }

  /**
   * Seek the master clock to an absolute time. All engines reposition.
   * Pauses if playing — symmetric with single-engine seekToTime.
   */
  seekToTime(time: number): void {
    if (this.engines.size === 0) return;
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.currentTime = time;
    if (time > this.maxReachedTime) this.maxReachedTime = time;
    for (const engine of this.engines.values()) {
      engine.seekToOrBefore(time);
    }
    this.emit({ type: "seek", time });
    if (wasPlaying && !this.allEnginesAtEnd()) this.play();
  }

  // ---- Subscription -------------------------------------------------------

  /** Subscribe to master clock events (play/pause/seek/speed/tick/end). */
  subscribe(fn: MasterClockSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /**
   * Subscribe to a single engine's events (bar / load / etc). Returns a no-op
   * unsubscribe if the symbol has no engine. Used by the chart per-pane and by
   * providers.tsx to wire processBar per instrument.
   */
  subscribeEngine(symbol: string, fn: ReplaySubscriber): () => void {
    const engine = this.engines.get(symbol);
    if (!engine) return () => undefined;
    return engine.subscribe(fn);
  }

  // ---- Accessors ----------------------------------------------------------

  getEngine(symbol: string): ReplayEngine | null {
    return this.engines.get(symbol) ?? null;
  }

  getEngineSymbols(): string[] {
    return Array.from(this.engines.keys());
  }

  getEngineCount(): number {
    return this.engines.size;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getMaxReachedTime(): number {
    return this.maxReachedTime;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getSpeed(): SpeedSetting {
    return this.speed;
  }

  // ---- Internal -----------------------------------------------------------

  private scheduleNext(): void {
    this.cancelTimer();
    const intervalMs = BASE_INTERVAL_MS / this.speed;
    this.timerId = setTimeout(() => this.tick(), intervalMs);
  }

  private tick(): void {
    if (!this.playing) return;
    if (this.allEnginesAtEnd()) {
      this.playing = false;
      this.emit({ type: "end" });
      return;
    }
    this.advanceMasterTime(this.currentTime + MASTER_STEP_SEC);
    if (this.allEnginesAtEnd()) {
      this.playing = false;
      this.emit({ type: "end" });
      return;
    }
    this.scheduleNext();
  }

  private advanceMasterTime(target: number): void {
    this.currentTime = target;
    if (target > this.maxReachedTime) this.maxReachedTime = target;
    for (const engine of this.engines.values()) {
      engine.advanceTo(target);
    }
    this.emit({ type: "tick", time: target });
  }

  private allEnginesAtEnd(): boolean {
    if (this.engines.size === 0) return true;
    for (const engine of this.engines.values()) {
      const last = engine.getLastBar();
      if (!last) continue;
      if (engine.getCurrentIndex() < engine.getTotalBars() - 1) return false;
    }
    return true;
  }

  private cancelTimer(): void {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private emit(event: MasterClockEvent): void {
    for (const sub of this.subscribers) sub(event);
  }
}

/** For tests: a way to detect timer leaks after dispose. */
export function isClockIdle(clock: MasterClock): boolean {
  return !clock.isPlaying() && clock.getEngineCount() === 0;
}

// Re-export so consumers can import all engine types from one place.
export type { ReplayEvent, ReplaySubscriber };
