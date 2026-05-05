import { create } from "zustand";

import type { Bar } from "@/types/bar";
import type { SpeedSetting } from "@/types/session";
import type { DataProvider, ResolutionString } from "@/lib/data/DataProvider";
import { ReplayEngine } from "@/lib/engine/ReplayEngine";
import { MasterClock } from "@/lib/engine/MasterClock";

/**
 * v2.2.5α: components subscribe via Zustand selectors rather than touching the
 * engine instance directly. The store holds a MasterClock + N engines (one per
 * instrument) + mirrors the fields React components need to render
 * (currentBarTime, isPlaying, etc.).
 *
 * Single-instrument sessions (v1, legacy battles, local sessions): MasterClock
 * has exactly one engine. `engine` points to it. All existing UI keeps working.
 *
 * Multi-instrument sessions (v2 server battles with instruments[]): MasterClock
 * has 1-5 engines. `engine` points to the *active* instrument's engine — i.e.,
 * the engine for the focused chart pane. Order routing, getCurrentPrice for the
 * active pane, etc., all read `engine` and continue to behave correctly. Code
 * that needs an instrument other than the active one calls getEngine(symbol).
 */
export interface ReplayState {
  /** The shared coordinator. Owns timer + N engines + lifecycle. */
  masterClock: MasterClock | null;
  /** Symbol → engine. Mirrored from masterClock.engines for selector use. */
  engines: Map<string, ReplayEngine>;
  /** The focused instrument. Drives order routing and the legacy `engine` ref. */
  activeInstrument: string | null;
  /**
   * Active engine reference — `engines.get(activeInstrument) ?? null`. Kept as
   * a top-level field for selector compatibility with existing single-engine UI.
   */
  engine: ReplayEngine | null;

  // Mirrored MasterClock state
  /** Master market time in unix seconds. */
  currentBarTime: number;
  isPlaying: boolean;
  speed: SpeedSetting;
  maxReachedTime: number;

  // Mirrored from the ACTIVE engine
  currentBarIndex: number;
  totalBars: number;
  maxReachedIndex: number;

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

  // Multi-engine actions
  /**
   * v2.2.5α: instantiate engines for each instrument and seat them at startTime.
   * Replaces initEngine for multi-asset sessions. The first symbol in `symbols`
   * becomes the default activeInstrument; callers may override later.
   */
  initEnginesMulti: (
    barsBySymbol: Map<string, Bar[]>,
    startTime: number,
    activeInstrument?: string,
  ) => void;
  /** Switch which instrument is the focused/active one. Updates `engine` ref + mirrored fields. */
  setActiveInstrument: (symbol: string) => void;
  /** Look up an engine by symbol — for code that needs a specific instrument's price/bar. */
  getEngine: (symbol: string) => ReplayEngine | null;
  /** Tear down the masterClock + all engines. Called on /trade route unmount. */
  dispose: () => void;

  // Single-engine (legacy v1) actions — implemented atop MasterClock with 1 engine.
  initEngine: (bars: Bar[], startIndex?: number) => void;
  loadInstrument: (
    provider: DataProvider,
    symbol: string,
    resolution?: ResolutionString,
    startFraction?: number,
  ) => Promise<{ totalBars: number }>;
  /**
   * v2.2.5α: load N instruments via the DataProvider in parallel and seat them
   * at startBarTime. Used by the trade page when the active session belongs to
   * a multi-asset server battle.
   */
  loadInstrumentsMulti: (
    provider: DataProvider,
    symbols: string[],
    startBarTime: number,
    resolution?: ResolutionString,
  ) => Promise<{ instrumentCount: number }>;

  // Playback
  play: () => void;
  pause: () => void;
  step: (dir: "forward" | "back", count?: number) => void;
  setSpeed: (s: SpeedSetting) => void;
  setStepMinutes: (m: number) => void;
  seek: (time: number) => void;
}

export const useReplayStore = create<ReplayState>((set, get) => {
  /**
   * Subscribe a fresh MasterClock to mirror its state into the store. Returns
   * the unsubscribe handle so callers (initEnginesMulti, dispose) can detach.
   */
  const wireMaster = (clock: MasterClock): (() => void) => {
    const unsubMaster = clock.subscribe((event) => {
      switch (event.type) {
        case "play":
          set({ isPlaying: true });
          break;
        case "pause":
        case "end":
          set({ isPlaying: false });
          break;
        case "speed":
          set({ speed: event.speed });
          break;
        case "tick":
        case "seek":
          set({
            currentBarTime: event.time,
            maxReachedTime: clock.getMaxReachedTime(),
          });
          // Mirror active-engine derived state.
          syncActiveEngineMirror();
          break;
      }
    });
    return unsubMaster;
  };

  /**
   * For each engine, attach a subscription that mirrors its current bar into
   * `currentBarIndex` / `totalBars` IFF that engine is the active one. Returns
   * a single unsubscribe that detaches all per-engine subscriptions.
   */
  const wireEngines = (clock: MasterClock): (() => void) => {
    const unsubs: (() => void)[] = [];
    for (const symbol of clock.getEngineSymbols()) {
      const engine = clock.getEngine(symbol);
      if (!engine) continue;
      const u = engine.subscribe((event) => {
        if (event.type !== "bar") return;
        if (get().activeInstrument === symbol) {
          set({
            currentBarIndex: event.index,
            maxReachedIndex: Math.max(get().maxReachedIndex, event.index),
          });
        }
      });
      unsubs.push(u);
    }
    return () => {
      for (const u of unsubs) u();
    };
  };

  /** Mirror the active engine's currentBarIndex / totalBars into the store. */
  const syncActiveEngineMirror = (): void => {
    const active = get().activeInstrument;
    if (!active) return;
    const e = get().engines.get(active);
    if (!e) return;
    set({
      currentBarIndex: e.getCurrentIndex(),
      totalBars: e.getTotalBars(),
      maxReachedIndex: Math.max(get().maxReachedIndex, e.getCurrentIndex()),
    });
  };

  let currentMasterUnsub: (() => void) | null = null;
  let currentEnginesUnsub: (() => void) | null = null;

  return {
    masterClock: null,
    engines: new Map(),
    activeInstrument: null,
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

    initEnginesMulti: (barsBySymbol, startTime, activeInstrument) => {
      // Tear down any prior instance before swapping in a fresh one.
      if (currentMasterUnsub) currentMasterUnsub();
      if (currentEnginesUnsub) currentEnginesUnsub();
      const prior = get().masterClock;
      if (prior) prior.disposeEngines();

      const clock = new MasterClock();
      clock.initEngines({ bars: barsBySymbol, startTime });

      const symbols = clock.getEngineSymbols();
      const active = activeInstrument && symbols.includes(activeInstrument)
        ? activeInstrument
        : symbols[0] ?? null;

      const enginesMap = new Map<string, ReplayEngine>();
      for (const sym of symbols) {
        const e = clock.getEngine(sym);
        if (e) enginesMap.set(sym, e);
      }
      const activeEngine = active ? (enginesMap.get(active) ?? null) : null;

      currentMasterUnsub = wireMaster(clock);
      currentEnginesUnsub = wireEngines(clock);

      set({
        masterClock: clock,
        engines: enginesMap,
        activeInstrument: active,
        engine: activeEngine,
        currentBarTime: startTime,
        currentBarIndex: activeEngine?.getCurrentIndex() ?? 0,
        totalBars: activeEngine?.getTotalBars() ?? 0,
        isPlaying: false,
        maxReachedTime: startTime,
        maxReachedIndex: activeEngine?.getCurrentIndex() ?? 0,
      });
    },

    setActiveInstrument: (symbol) => {
      const e = get().engines.get(symbol);
      if (!e) return;
      set({
        activeInstrument: symbol,
        engine: e,
        currentBarIndex: e.getCurrentIndex(),
        totalBars: e.getTotalBars(),
      });
    },

    getEngine: (symbol) => get().engines.get(symbol) ?? null,

    dispose: () => {
      if (currentMasterUnsub) currentMasterUnsub();
      if (currentEnginesUnsub) currentEnginesUnsub();
      currentMasterUnsub = null;
      currentEnginesUnsub = null;
      const clock = get().masterClock;
      if (clock) clock.disposeEngines();
      set({
        masterClock: null,
        engines: new Map(),
        activeInstrument: null,
        engine: null,
        currentBarTime: 0,
        currentBarIndex: 0,
        isPlaying: false,
        totalBars: 0,
        maxReachedTime: 0,
        maxReachedIndex: 0,
        visibleRange: null,
      });
    },

    initEngine: (bars, startIndex = 0) => {
      // Legacy single-engine path: build a 1-engine MasterClock, then seat at
      // the desired start index's time. Symbol is "_active" placeholder when
      // the caller doesn't know it (initEngine is called only from tests +
      // smoke flows; production loadInstrument uses the real symbol).
      const startTime = bars[startIndex]?.time ?? bars[0]?.time ?? 0;
      const map = new Map<string, Bar[]>();
      map.set("_active", bars);
      get().initEnginesMulti(map, startTime, "_active");
    },

    play: () => get().masterClock?.play(),
    pause: () => get().masterClock?.pause(),
    step: (dir, count = 1) => {
      const clock = get().masterClock;
      if (!clock) return;
      const n = Math.max(1, Math.floor(count));
      for (let i = 0; i < n; i++) clock.step(dir);
    },
    setSpeed: (s) => {
      const clock = get().masterClock;
      if (clock) clock.setSpeed(s);
      else set({ speed: s });
    },
    setStepMinutes: (m) => set({ stepMinutes: Math.max(1, Math.floor(m)) }),
    seek: (time) => get().masterClock?.seekToTime(time),

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
      const startTime = result.bars[startIndex].time;
      const map = new Map<string, Bar[]>();
      map.set(symbol, result.bars);
      get().initEnginesMulti(map, startTime, symbol);
      return { totalBars: result.bars.length };
    },

    loadInstrumentsMulti: async (
      provider,
      symbols,
      startBarTime,
      resolution = "1",
    ) => {
      const map = new Map<string, Bar[]>();
      for (const symbol of symbols) {
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
        map.set(symbol, result.bars);
      }

      // v2.2.5α single-bar fix: clamp the seat point to mid-dataset when the
      // requested startBarTime would put engines at or near bar 0 (which
      // produces a 1-bar chart with no history). Battle.startBarTime is
      // user-input and frequently falls outside the bundled 30-day dataset
      // range; honor it when usable, fall back to mid-dataset otherwise.
      // Mirrors the legacy single-instrument loadInstrument's startFraction=0.5.
      const refSymbol = symbols[0];
      const refBars = map.get(refSymbol);
      let effectiveStart = startBarTime;
      if (refBars && refBars.length > 0) {
        const firstTime = refBars[0].time;
        const midTime = refBars[Math.floor((refBars.length - 1) * 0.5)].time;
        const lastTime = refBars[refBars.length - 1].time;
        // Want at least 200 bars of history before the seat point — one
        // chart-screen worth at default zoom. If the requested startBarTime
        // doesn't deliver that, fall back to mid-dataset.
        const minHistoryIndex = Math.min(200, refBars.length - 1);
        const minHistoryTime = refBars[minHistoryIndex].time;
        if (
          startBarTime <= firstTime ||
          startBarTime > lastTime ||
          startBarTime < minHistoryTime
        ) {
          effectiveStart = midTime;
        }
      }

      get().initEnginesMulti(map, effectiveStart, symbols[0]);
      return { instrumentCount: symbols.length };
    },
  };
});
