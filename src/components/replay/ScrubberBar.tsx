"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useReplayStore } from "@/stores/replayStore";

/**
 * Time-based timeline scrubber.
 *
 * Layout: horizontal track spanning the full data range.
 *   • Filled bar (left of playhead)         — primary @ 70%
 *   • Visible-range rectangle              — translucent primary, follows
 *                                             chart pan/zoom in real time
 *   • Adaptive tick marks + date labels    — auto-scaled to range
 *   • Playhead vertical line + label       — follows engine.currentBar
 *   • Hover preview tooltip                — shows time at cursor
 *
 * Performance & responsiveness:
 *   • A single rAF loop drives the playhead, filled-bar width, AND visible
 *     rectangle via direct DOM mutation. Zero React re-renders during
 *     playback or chart pan.
 *   • During drag, the playhead's DOM position updates IMMEDIATELY on every
 *     pointermove — no engine round-trip on the visual feedback path.
 *     Engine seeks are throttled to ~20 Hz so the chart's setData redraw
 *     doesn't stall the drag.
 *   • Final seek is committed on pointerup so the cursor's release position
 *     is always the resting state.
 */
export function ScrubberBar({ className }: { className?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const playheadLabelRef = useRef<HTMLDivElement>(null);
  const filledRef = useRef<HTMLDivElement>(null);
  const visibleRectRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef<HTMLDivElement>(null);
  const tickContainerRef = useRef<HTMLDivElement>(null);

  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const wasPlayingBeforeScrub = useRef(false);
  // True while the user is actively dragging — when true, the rAF loop
  // skips updating the playhead from engine state, so the immediate DOM
  // updates from pointermove aren't fought over.
  const isDraggingRef = useRef(false);

  const engine = useReplayStore((s) => s.engine);
  const totalBars = useReplayStore((s) => s.totalBars);

  // Render fixed tick marks whenever the data range changes.
  useEffect(() => {
    const container = tickContainerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const e = useReplayStore.getState().engine;
    const first = e?.getFirstBar();
    const last = e?.getLastBar();
    if (!e || !first || !last) return;

    const totalSec = last.time - first.time;
    if (totalSec <= 0) return;

    const trackWidth = container.clientWidth;
    if (trackWidth === 0) return;

    const targetTickPx = 100;
    const tickCount = Math.max(2, Math.floor(trackWidth / targetTickPx));
    const tickStep = totalSec / tickCount;

    const niceSteps = [
      60, 300, 900, 1800, 3600, 10_800, 21_600, 43_200, 86_400, 86_400 * 2,
      86_400 * 7,
    ];
    const snapped = niceSteps.find((s) => s >= tickStep) ?? 86_400 * 7;
    const startSnapped = Math.ceil(first.time / snapped) * snapped;

    for (let t = startSnapped; t <= last.time; t += snapped) {
      const pct = (t - first.time) / totalSec;
      const tick = document.createElement("div");
      Object.assign(tick.style, {
        position: "absolute",
        left: `${pct * 100}%`,
        top: "0",
        bottom: "0",
        width: "1px",
        background: "hsl(var(--border))",
        opacity: "0.5",
      } as Partial<CSSStyleDeclaration>);
      container.appendChild(tick);

      const label = document.createElement("div");
      const d = new Date(t * 1000);
      label.textContent = formatTickLabel(d, snapped);
      Object.assign(label.style, {
        position: "absolute",
        left: `${pct * 100}%`,
        top: "100%",
        transform: "translateX(-50%)",
        marginTop: "4px",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "10px",
        color: "hsl(var(--muted-foreground))",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      } as Partial<CSSStyleDeclaration>);
      container.appendChild(label);
    }
  }, [engine, totalBars]);

  /**
   * Update playhead DOM (line transform + label transform/text + filled
   * width). Declared before the rAF effect so the lint rule allowing
   * forward references is satisfied.
   */
  const applyPlayheadDom = (x: number, time: number) => {
    const line = playheadLineRef.current;
    const label = playheadLabelRef.current;
    const filled = filledRef.current;
    const track = trackRef.current;
    if (!line || !label || !filled || !track) return;
    const trackWidth = track.clientWidth;
    line.style.transform = `translateX(${x}px)`;
    label.style.transform = `translate(${x}px, -100%)`;
    label.textContent = formatPlayheadLabel(new Date(time * 1000));
    filled.style.width = trackWidth > 0 ? `${(x / trackWidth) * 100}%` : "0%";
  };

  /**
   * Translate a clientX into a track-local x and a target time, clamped at
   * the high water mark — bars past `maxReachedTime` aren't yet revealed
   * and can't be scrubbed to.
   */
  const xToTime = (clientX: number): { x: number; time: number } | null => {
    const e = useReplayStore.getState().engine;
    const track = trackRef.current;
    if (!e || !track) return null;
    const first = e.getFirstBar();
    const last = e.getLastBar();
    if (!first || !last) return null;
    const rect = track.getBoundingClientRect();
    const totalSec = last.time - first.time;
    if (totalSec <= 0 || rect.width === 0) return null;

    const maxTime = useReplayStore.getState().maxReachedTime || last.time;
    const maxX = ((maxTime - first.time) / totalSec) * rect.width;

    const rawX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const x = Math.min(rawX, maxX);
    const pct = x / rect.width;
    const time = first.time + pct * totalSec;
    return { x, time };
  };

  // 60fps rAF loop — playhead, filled bar, visible-range rectangle.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const e = useReplayStore.getState().engine;
      const visible = useReplayStore.getState().visibleRange;
      const track = trackRef.current;
      if (!e || !track) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const first = e.getFirstBar();
      const last = e.getLastBar();
      const cur = e.getCurrentBar();
      if (!first || !last || !cur) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const totalSec = last.time - first.time;
      const trackWidth = track.clientWidth;
      if (totalSec <= 0 || trackWidth === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      // Playhead — skip during drag (DOM is being mutated by pointer events).
      if (!isDraggingRef.current) {
        const pct = clamp01((cur.time - first.time) / totalSec);
        const x = pct * trackWidth;
        applyPlayheadDom(x, cur.time);
      }

      // Visible-range rectangle (chart viewport)
      const rect = visibleRectRef.current;
      if (rect) {
        if (!visible) {
          rect.style.display = "none";
        } else {
          const fromPct = clamp01((visible.from - first.time) / totalSec);
          const toPct = clamp01((visible.to - first.time) / totalSec);
          const left = fromPct * trackWidth;
          const width = Math.max(2, (toPct - fromPct) * trackWidth);
          rect.style.display = "block";
          rect.style.transform = `translateX(${left}px)`;
          rect.style.width = `${width}px`;
        }
      }

      // Locked region — bars past the high water mark are unrevealed future.
      const lock = lockedRef.current;
      if (lock) {
        const maxTime = useReplayStore.getState().maxReachedTime || last.time;
        const maxPct = clamp01((maxTime - first.time) / totalSec);
        const maxX = maxPct * trackWidth;
        const lockedWidth = Math.max(0, trackWidth - maxX);
        if (lockedWidth <= 0.5) {
          lock.style.display = "none";
        } else {
          lock.style.display = "block";
          lock.style.transform = `translateX(${maxX}px)`;
          lock.style.width = `${lockedWidth}px`;
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    if (!track) return;

    const replay = useReplayStore.getState();
    if (replay.isPlaying) {
      wasPlayingBeforeScrub.current = true;
      replay.pause();
    }

    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    isDraggingRef.current = true;

    // Throttle engine seeks to ~20 Hz so setData redraws don't stall the
    // drag. Visual playhead always tracks immediately.
    let lastSeekAt = 0;
    const SEEK_THROTTLE_MS = 50;
    const seekIfDue = (time: number, force = false) => {
      const now = performance.now();
      if (force || now - lastSeekAt >= SEEK_THROTTLE_MS) {
        lastSeekAt = now;
        useReplayStore.getState().engine?.seekToTime(time);
      }
    };

    // Initial commit at click point.
    const init = xToTime(e.clientX);
    if (init) {
      applyPlayheadDom(init.x, init.time);
      seekIfDue(init.time, true);
    }

    const onMove = (ev: PointerEvent) => {
      const m = xToTime(ev.clientX);
      if (!m) return;
      applyPlayheadDom(m.x, m.time); // instant visual feedback
      seekIfDue(m.time);             // throttled engine seek
    };
    const onUp = (ev: PointerEvent) => {
      isDraggingRef.current = false;
      try {
        track.releasePointerCapture(ev.pointerId);
      } catch {
        // ignore
      }
      track.removeEventListener("pointermove", onMove);
      track.removeEventListener("pointerup", onUp);
      track.removeEventListener("pointercancel", onUp);
      // Final commit at release position so the engine matches the cursor.
      const fin = xToTime(ev.clientX);
      if (fin) seekIfDue(fin.time, true);
      if (wasPlayingBeforeScrub.current) {
        wasPlayingBeforeScrub.current = false;
        useReplayStore.getState().play();
      }
    };
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onUp);
  };

  const onMouseMoveHover = (e: React.MouseEvent) => {
    const m = xToTime(e.clientX);
    if (m) setHover(m);
  };

  return (
    <div
      className={cn(
        "select-none border-t border-border bg-card/50 px-4 pt-3 pb-7",
        className,
      )}
    >
      <div className="relative">
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onMouseMove={onMouseMoveHover}
          onMouseLeave={() => setHover(null)}
          className="relative h-2 w-full cursor-pointer rounded-full bg-secondary/60 touch-none"
        >
          {/* Filled portion (played-up-to bar) */}
          <div
            ref={filledRef}
            className="pointer-events-none absolute left-0 top-0 h-full rounded-full bg-primary/70"
            style={{ width: "0%" }}
          />

          {/* Locked region — unrevealed future, can't be scrubbed into */}
          <div
            ref={lockedRef}
            className="pointer-events-none absolute left-0 top-0 h-full rounded-r-full bg-foreground/10 [background-image:repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.04)_4px_8px)]"
            style={{ width: "0px", display: "none" }}
          />

          {/* Chart-viewport rectangle (follows pan / zoom) */}
          <div
            ref={visibleRectRef}
            className="pointer-events-none absolute -top-1 left-0 h-4 rounded-sm border border-primary/50 bg-primary/10"
            style={{ width: "0px", display: "none" }}
          />

          {/* Tick container */}
          <div
            ref={tickContainerRef}
            className="pointer-events-none absolute inset-0"
          />

          {/* Playhead vertical line */}
          <div
            ref={playheadLineRef}
            className="pointer-events-none absolute -top-2 left-0 h-6 w-0.5 -translate-x-1/2 bg-primary shadow-[0_0_6px_rgba(61,169,252,0.6)]"
            style={{ transform: "translateX(0px)" }}
          />

          {/* Playhead label (timestamp pill) */}
          <div
            ref={playheadLabelRef}
            className="pointer-events-none absolute -top-1 left-0 -translate-y-full whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[10px] tabular-nums text-foreground shadow-md"
            style={{ transform: "translate(0px, -100%)" }}
          >
            —
          </div>

          {/* Hover preview */}
          {hover && (
            <div
              className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground backdrop-blur-sm"
              style={{ left: `${hover.x}px`, marginTop: "-22px" }}
            >
              {formatHoverLabel(new Date(hover.time * 1000))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- helpers --------------------------------------------------------------

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function formatPlayheadLabel(d: Date): string {
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${month} ${day} · ${hh}:${mm} UTC`;
}

function formatHoverLabel(d: Date): string {
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

function formatTickLabel(d: Date, intervalSec: number): string {
  if (intervalSec >= 86_400) {
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return `${month} ${d.getUTCDate()}`;
  }
  if (intervalSec >= 3600) {
    return `${d.getUTCHours().toString().padStart(2, "0")}:00`;
  }
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d.getUTCMinutes().toString().padStart(2, "0")}`;
}
