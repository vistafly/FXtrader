import { create } from "zustand";

import type { Bar } from "@/types/bar";
import type { SpeedSetting } from "@/types/session";
import type { DataProvider, ResolutionString } from "@/lib/data/DataProvider";
import { ReplayEngine } from "@/lib/engine/ReplayEngine";

/**
 * Per spec §5: components subscribe via Zustand selectors rather than touching
 * the engine instance directly. The store holds the engine + mirrors the
 * fields React components need to render (currentBarTime, isPlaying, etc.).
 */
export interface ReplayState {
  engine: ReplayEngine | null;
  currentBarTime: number;
  currentBarIndex: number;
  isPlaying: boolean;
  speed: SpeedSetting;
  totalBars: number;
  /** Step granularity for the ⏮/⏭ buttons, in minutes. UI computes
   *  bars-to-advance from this and the active chart timeframe. */
  stepMinutes: number;
  /**
   * Current chart visible time range in Unix seconds. Updated imperatively
   * from ChartContainer's subscription to the chart-provider visible-range
   * event. Read by the scrubber's rAF loop (no React subscription) so chart
   * pan/zoom doesn't trigger re-renders elsewhere.
   */
  visibleRange: { from: number; to: number } | null;
  /**
   * High water mark — the highest bar index AND time the engine has ever
   * reached since session start. Grows on every forward bar event, never
   * shrinks. Used by the scrubber to lock the "future" region (bars not
   * yet revealed via Play); the user can scrub freely between 0 and this
   * point.
   */
  maxReachedIndex: number;
  maxReachedTime: number;

  initEngine: (bars: Bar[], startIndex?: number) => void;
  play: () => void;
  pause: () => void;
  step: (dir: "forward" | "back", count?: number) => void;
  setSpeed: (s: SpeedSetting) => void;
  setStepMinutes: (m: number) => void;
  seek: (time: number) => void;

  /**
   * Convenience action used by smoke tests and (in Phase 5) the trade page.
   * Resolves the symbol via the DataProvider, fetches all bars, and seats them
   * in a fresh engine.
   *
   * @param startFraction Fraction of the dataset (0–1) revealed as history at
   *   load time. Default 0.5 — half visible, half to replay forward into.
   *   The smoke test passes 0 explicitly to start at the very beginning.
   */
  loadInstrument: (
    provider: DataProvider,
    symbol: string,
    resolution?: ResolutionString,
    startFraction?: number,
  ) => Promise<{ totalBars: number }>;
}

export const useReplayStore = create<ReplayState>((set, get) => {
  // Wire engine events → mirrored store state. Same subscribe handler is reused
  // every time `initEngine` is called.
  const wire = (engine: ReplayEngine) =>
    engine.subscribe((event) => {
      switch (event.type) {
        case "load": {
          const loadBar = engine.getCurrentBar();
          set({
            totalBars: event.totalBars,
            currentBarIndex: event.index,
            // High water mark starts at the load index (the "current loaded date").
            maxReachedIndex: event.index,
            maxReachedTime: loadBar?.time ?? 0,
          });
          break;
        }
        case "bar":
          set((state) => {
            const grown = event.index > state.maxReachedIndex;
            return {
              currentBarIndex: event.index,
              currentBarTime: event.bar.time,
              maxReachedIndex: grown ? event.index : state.maxReachedIndex,
              maxReachedTime: grown ? event.bar.time : state.maxReachedTime,
            };
          });
          break;
        case "play":
          set({ isPlaying: true });
          break;
        case "pause":
        case "end":
          set({ isPlaying: false });
          break;
        case "seek":
          set({ currentBarIndex: event.index });
          break;
        case "speed":
          set({ speed: event.speed });
          break;
      }
    });

  return {
    engine: null,
    currentBarTime: 0,
    currentBarIndex: 0,
    isPlaying: false,
    speed: 1,
    totalBars: 0,
    stepMinutes: 1,
    visibleRange: null,
    maxReachedIndex: 0,
    maxReachedTime: 0,

    initEngine: (bars, startIndex = 0) => {
      const engine = new ReplayEngine();
      wire(engine);
      engine.load(bars, startIndex);
      set({ engine });
    },

    play: () => get().engine?.play(),
    pause: () => get().engine?.pause(),
    step: (dir, count = 1) => {
      const engine = get().engine;
      if (!engine) return;
      const n = Math.max(1, Math.floor(count));
      for (let i = 0; i < n; i++) engine.step(dir);
    },
    setSpeed: (s) => {
      const e = get().engine;
      if (e) e.setSpeed(s);
      else set({ speed: s });
    },
    setStepMinutes: (m) => set({ stepMinutes: Math.max(1, Math.floor(m)) }),
    seek: (time) => get().engine?.seekToTime(time),

    loadInstrument: async (
      provider,
      symbol,
      resolution = "1",
      startFraction = 0.5,
    ) => {
      const symbolInfo = await provider.resolveSymbol(symbol);
      const result = await provider.getBars(symbolInfo, resolution, {
        from: 0,
        to: Number.MAX_SAFE_INTEGER,
        countBack: Number.MAX_SAFE_INTEGER,
        firstDataRequest: true,
      });
      if (result.bars.length === 0) {
        throw new Error(`No bars available for ${symbol}`);
      }
      const clampedFraction = Math.max(0, Math.min(1, startFraction));
      const startIndex = Math.floor((result.bars.length - 1) * clampedFraction);
      get().initEngine(result.bars, startIndex);
      return { totalBars: result.bars.length };
    },
  };
});
