import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReplayEngine, type ReplayEvent } from "./ReplayEngine";
import { makeSampleBars } from "./__fixtures__/sampleBars";

describe("ReplayEngine — load + accessors", () => {
  it("loads bars and exposes initial state", () => {
    const engine = new ReplayEngine();
    const bars = makeSampleBars(100);
    engine.load(bars, 0);

    expect(engine.getTotalBars()).toBe(100);
    expect(engine.getCurrentIndex()).toBe(0);
    expect(engine.getCurrentBar()).toBe(bars[0]);
    expect(engine.getVisibleBars()).toHaveLength(1);
    expect(engine.isPlaying()).toBe(false);
    expect(engine.getSpeed()).toBe(1);
  });

  it("clamps a startIndex out of range", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(50), 999);
    expect(engine.getCurrentIndex()).toBe(49);
  });

  it("throws on empty bar array", () => {
    const engine = new ReplayEngine();
    expect(() => engine.load([])).toThrow();
  });

  it("emits load + initial bar event", () => {
    const engine = new ReplayEngine();
    const events: ReplayEvent[] = [];
    engine.subscribe((e) => events.push(e));

    engine.load(makeSampleBars(10), 0);

    expect(events.map((e) => e.type)).toEqual(["load", "bar"]);
  });
});

describe("ReplayEngine — step", () => {
  it("steps forward and back", () => {
    const engine = new ReplayEngine();
    const bars = makeSampleBars(100);
    engine.load(bars, 50);

    engine.step("forward");
    expect(engine.getCurrentIndex()).toBe(51);

    engine.step("back");
    expect(engine.getCurrentIndex()).toBe(50);
  });

  it("clamps stepping past boundaries", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(10), 0);

    engine.step("back");
    expect(engine.getCurrentIndex()).toBe(0);

    engine.seekToIndex(9);
    engine.step("forward");
    expect(engine.getCurrentIndex()).toBe(9);
  });

  it("pauses if playing when stepped", () => {
    vi.useFakeTimers();
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(50), 0);
    engine.play();
    expect(engine.isPlaying()).toBe(true);

    engine.step("forward");
    expect(engine.isPlaying()).toBe(false);
    vi.useRealTimers();
  });
});

describe("ReplayEngine — play/pause with fake timers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits one bar event per tick at 1× (1000ms interval)", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(100), 0);

    const barEvents: ReplayEvent[] = [];
    engine.subscribe((e) => {
      if (e.type === "bar") barEvents.push(e);
    });
    barEvents.length = 0; // discard the initial-bar event from load()

    engine.play();
    expect(engine.isPlaying()).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(barEvents).toHaveLength(1);
    expect((barEvents[0] as { index: number }).index).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(barEvents).toHaveLength(2);
    expect(engine.getCurrentIndex()).toBe(2);
  });

  it("speed change applies on the next tick", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(100), 0);

    const barEvents: ReplayEvent[] = [];
    engine.subscribe((e) => {
      if (e.type === "bar") barEvents.push(e);
    });
    barEvents.length = 0;

    engine.play();
    vi.advanceTimersByTime(1000); // 1× → 1 tick
    expect(engine.getCurrentIndex()).toBe(1);

    engine.setSpeed(4);
    vi.advanceTimersByTime(250); // 4× → first tick after speed change
    expect(engine.getCurrentIndex()).toBe(2);

    vi.advanceTimersByTime(250);
    expect(engine.getCurrentIndex()).toBe(3);
  });

  it("pause stops further bar emissions", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(100), 0);

    let barCount = 0;
    engine.subscribe((e) => {
      if (e.type === "bar") barCount++;
    });
    barCount = 0;

    engine.play();
    vi.advanceTimersByTime(1000);
    expect(barCount).toBe(1);

    engine.pause();
    expect(engine.isPlaying()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(barCount).toBe(1);
  });

  it("emits 'end' and stops playing at the last bar", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(5), 0);

    const events: ReplayEvent[] = [];
    engine.subscribe((e) => events.push(e));

    engine.play();
    vi.advanceTimersByTime(10_000); // way past the end

    expect(engine.isPlaying()).toBe(false);
    expect(events.some((e) => e.type === "end")).toBe(true);
    expect(engine.getCurrentIndex()).toBe(4);
  });

  it("calling play() at the last bar is a no-op", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(3), 0);
    engine.seekToIndex(2);

    let playEvents = 0;
    engine.subscribe((e) => {
      if (e.type === "play") playEvents++;
    });

    engine.play();
    expect(engine.isPlaying()).toBe(false);
    expect(playEvents).toBe(0);
  });
});

describe("ReplayEngine — seek", () => {
  it("seekToIndex emits seek + bar", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(100), 0);

    const events: ReplayEvent[] = [];
    engine.subscribe((e) => events.push(e));

    engine.seekToIndex(42);

    expect(engine.getCurrentIndex()).toBe(42);
    const types = events.map((e) => e.type);
    expect(types).toContain("seek");
    expect(types).toContain("bar");
  });

  it("seekToTime jumps to the first bar at-or-after that time", () => {
    const engine = new ReplayEngine();
    const bars = makeSampleBars(100, 1_700_000_000);
    engine.load(bars, 0);

    // bars[10].time === 1_700_000_000 + 10*60 === 1_700_000_600
    engine.seekToTime(1_700_000_600);
    expect(engine.getCurrentIndex()).toBe(10);
  });

  it("seekToTime past end clamps to last bar", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(10), 0);
    engine.seekToTime(9_999_999_999);
    expect(engine.getCurrentIndex()).toBe(9);
  });
});

describe("ReplayEngine — subscription lifecycle", () => {
  it("subscribe returns an unsubscribe function", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(10), 0);

    let count = 0;
    const unsubscribe = engine.subscribe(() => count++);
    engine.step("forward");
    expect(count).toBeGreaterThan(0);

    const stamp = count;
    unsubscribe();
    engine.step("forward");
    expect(count).toBe(stamp);
  });

  it("multiple subscribers all receive events", () => {
    const engine = new ReplayEngine();
    engine.load(makeSampleBars(10), 0);

    const a: ReplayEvent[] = [];
    const b: ReplayEvent[] = [];
    engine.subscribe((e) => a.push(e));
    engine.subscribe((e) => b.push(e));

    engine.step("forward");
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(0);
  });
});
