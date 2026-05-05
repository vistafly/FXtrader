import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MasterClock, isClockIdle, type MasterClockEvent } from "./MasterClock";
import type { ReplayEvent } from "./ReplayEngine";
import { makeSampleBars } from "./__fixtures__/sampleBars";

const START = 1_700_000_000;

function buildBars(): Map<string, ReturnType<typeof makeSampleBars>> {
  const bars = new Map<string, ReturnType<typeof makeSampleBars>>();
  bars.set("EURUSD", makeSampleBars(50, START));
  bars.set("GBPUSD", makeSampleBars(50, START));
  bars.set("NQ1!", makeSampleBars(50, START));
  return bars;
}

describe("MasterClock — initEngines + lifecycle", () => {
  it("instantiates one engine per instrument and seats them at startTime", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });
    expect(clock.getEngineCount()).toBe(3);
    expect(clock.getEngineSymbols()).toEqual(["EURUSD", "GBPUSD", "NQ1!"]);
    expect(clock.getCurrentTime()).toBe(START);
    for (const sym of ["EURUSD", "GBPUSD", "NQ1!"]) {
      const e = clock.getEngine(sym);
      expect(e).not.toBeNull();
      expect(e?.getCurrentBar()?.time).toBe(START);
    }
  });

  it("getEngine returns null for unknown symbols", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });
    expect(clock.getEngine("USDJPY")).toBeNull();
  });

  it("re-initializing wipes prior engines", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    const onlyOne = new Map([["AAPL", makeSampleBars(20, START)]]);
    clock.initEngines({ bars: onlyOne, startTime: START });
    expect(clock.getEngineCount()).toBe(1);
    expect(clock.getEngine("EURUSD")).toBeNull();
  });

  it("disposeEngines: 3 engines created, dispose, zero engines + zero active timers (leak guard)", () => {
    vi.useFakeTimers();
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });
    expect(clock.getEngineCount()).toBe(3);

    // Fire timers + subscribers, then dispose. After dispose, advancing
    // wall-clock by 60s × 1000 must not produce any events anywhere.
    let masterEvents = 0;
    let perEngineEvents = 0;
    clock.subscribe(() => masterEvents++);
    clock.subscribeEngine("EURUSD", () => perEngineEvents++);
    clock.subscribeEngine("GBPUSD", () => perEngineEvents++);
    clock.subscribeEngine("NQ1!", () => perEngineEvents++);

    clock.play();
    vi.advanceTimersByTime(2000); // 2 ticks @ 1×
    expect(masterEvents).toBeGreaterThan(0);

    const stampMaster = masterEvents;
    const stampEngine = perEngineEvents;
    clock.disposeEngines();

    expect(isClockIdle(clock)).toBe(true);
    expect(clock.getEngineCount()).toBe(0);
    expect(clock.isPlaying()).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(masterEvents).toBe(stampMaster);
    expect(perEngineEvents).toBe(stampEngine);

    vi.useRealTimers();
  });
});

describe("MasterClock — playback control", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("play advances master time by 60s per tick at 1×, fanning out to all engines", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    const ticks: number[] = [];
    clock.subscribe((e) => {
      if (e.type === "tick") ticks.push(e.time);
    });

    clock.play();
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([START + 60]);
    vi.advanceTimersByTime(1000);
    expect(ticks).toEqual([START + 60, START + 120]);

    // After 2 ticks all 3 engines should be at their bars[2] (time = START + 120).
    for (const sym of ["EURUSD", "GBPUSD", "NQ1!"]) {
      const e = clock.getEngine(sym);
      expect(e?.getCurrentBar()?.time).toBe(START + 120);
    }
  });

  it("processBar runs for each engine independently — per-engine bar events fire on tick", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    const eur: ReplayEvent[] = [];
    const gbp: ReplayEvent[] = [];
    clock.subscribeEngine("EURUSD", (e) => eur.push(e));
    clock.subscribeEngine("GBPUSD", (e) => gbp.push(e));

    clock.play();
    vi.advanceTimersByTime(3000); // 3 ticks

    const eurBars = eur.filter((e) => e.type === "bar");
    const gbpBars = gbp.filter((e) => e.type === "bar");
    expect(eurBars).toHaveLength(3);
    expect(gbpBars).toHaveLength(3);
  });

  it("speed change applies on next tick and fans out", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    const ticks: number[] = [];
    clock.subscribe((e) => {
      if (e.type === "tick") ticks.push(e.time);
    });

    clock.play();
    vi.advanceTimersByTime(1000); // 1×: 1 tick
    expect(ticks).toHaveLength(1);

    clock.setSpeed(4);
    vi.advanceTimersByTime(250); // 4×: 1 tick
    expect(ticks).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(ticks).toHaveLength(3);
  });

  it("pause halts further ticks across all engines", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    let count = 0;
    clock.subscribe((e) => {
      if (e.type === "tick") count++;
    });

    clock.play();
    vi.advanceTimersByTime(1000);
    expect(count).toBe(1);

    clock.pause();
    vi.advanceTimersByTime(5000);
    expect(count).toBe(1);
  });

  it("emits 'end' once all engines reach their last bar", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    const events: MasterClockEvent[] = [];
    clock.subscribe((e) => events.push(e));

    clock.play();
    vi.advanceTimersByTime(60_000); // way past end (49 bars × 1000ms)
    expect(events.some((e) => e.type === "end")).toBe(true);
    expect(clock.isPlaying()).toBe(false);
  });
});

describe("MasterClock — seek + step", () => {
  it("seekToTime moves all engines to the same target time", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    clock.seekToTime(START + 600);
    expect(clock.getCurrentTime()).toBe(START + 600);
    for (const sym of ["EURUSD", "GBPUSD", "NQ1!"]) {
      const e = clock.getEngine(sym);
      expect(e?.getCurrentBar()?.time).toBe(START + 600);
    }
  });

  it("step forward advances master time by 60s and fans out", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    clock.step("forward");
    expect(clock.getCurrentTime()).toBe(START + 60);
    for (const sym of ["EURUSD", "GBPUSD", "NQ1!"]) {
      expect(clock.getEngine(sym)?.getCurrentBar()?.time).toBe(START + 60);
    }
  });

  it("step backward is supported via per-engine seekToTime", () => {
    const clock = new MasterClock();
    clock.initEngines({ bars: buildBars(), startTime: START });

    clock.seekToTime(START + 300);
    clock.step("back");
    expect(clock.getCurrentTime()).toBe(START + 240);
    for (const sym of ["EURUSD", "GBPUSD", "NQ1!"]) {
      expect(clock.getEngine(sym)?.getCurrentBar()?.time).toBe(START + 240);
    }
  });
});

describe("MasterClock — closed-market handling (engine without a bar at target time)", () => {
  it("an engine whose data is missing the target time stays put while others advance", () => {
    const clock = new MasterClock();

    // Imagine NQ1! is closed for an hour; its bars skip from START to START+3600.
    const eurBars = makeSampleBars(50, START);
    const nqBars: typeof eurBars = [];
    // First bar at START.
    nqBars.push({ ...eurBars[0] });
    // Next bar one hour later.
    nqBars.push({ ...eurBars[0], time: START + 3600 });

    const bars = new Map<string, typeof eurBars>();
    bars.set("EURUSD", eurBars);
    bars.set("NQ1!", nqBars);

    clock.initEngines({ bars, startTime: START });

    // Advance the master clock by 5 minutes.
    clock.seekToTime(START + 300);
    expect(clock.getEngine("EURUSD")?.getCurrentBar()?.time).toBe(START + 300);
    // NQ1! has no bar in (START, START+3600], so it stays at the START bar.
    expect(clock.getEngine("NQ1!")?.getCurrentBar()?.time).toBe(START);
  });
});
