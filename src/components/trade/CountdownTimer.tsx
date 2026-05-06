"use client";

import { Clock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /**
   * Wall-clock end-of-window timestamp in MILLISECONDS. Typically
   * computed as `battle.startedAt + durationMinutes * 60 * 1000`.
   *
   * Why wall-clock instead of replay-clock: the BATTLE window is
   * shared across participants — everyone has the same wall-clock
   * deadline. Replay-clock would diverge per attempt (different
   * play speeds, scrubbing). The original D7 plan (replay-time
   * anchored) was written for single-player attempts; multiplayer
   * battles need the wall-clock anchor.
   */
  endsAtMs: number;
  /**
   * Fired once when the countdown crosses zero. Auto-Submit-Final
   * for server attempts. Per D9 the timer keeps ticking during
   * watch-on-after-liquidation mode; the trade page debounces
   * the auto-fire on session.status === "ended".
   */
  onExpire?: () => void;
  /** Disable expire callback. */
  disableExpire?: boolean;
  className?: string;
}

const WARN_THRESHOLD_SEC = 5 * 60; // 5 minutes — flips chip to bear color

/**
 * v2.3 sub-phase 3 (revised): wall-clock countdown for the trade-page
 * header. Ticks once per second; computes remaining time as
 * (endsAtMs - Date.now()). Visible whenever the parent passes a
 * positive endsAtMs.
 */
export function CountdownTimer({
  endsAtMs,
  onExpire,
  disableExpire,
  className,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useRef(false);

  // Tick every second while not expired. Stops the interval once
  // the countdown reaches zero so we don't keep firing renders for
  // ended attempts.
  useEffect(() => {
    if (now >= endsAtMs) return; // already expired; no need to tick
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [now, endsAtMs]);

  // Reset the expire-fired flag when the source endsAtMs changes
  // (new attempt / new battle).
  useEffect(() => {
    expiredRef.current = false;
  }, [endsAtMs]);

  const remainingMs = endsAtMs - now;
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  const expired = remainingMs <= 0;

  // Fire onExpire exactly once when the countdown crosses zero.
  useEffect(() => {
    if (disableExpire) return;
    if (!expired) return;
    if (expiredRef.current) return;
    expiredRef.current = true;
    onExpire?.();
  }, [expired, onExpire, disableExpire]);

  return (
    <div
      data-testid="countdown-timer"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-sm font-semibold tabular-nums shadow-sm",
        expired
          ? "bg-bear text-white"
          : remainingSec <= WARN_THRESHOLD_SEC
            ? "bg-bear/90 text-white animate-pulse"
            : "bg-primary text-primary-foreground",
        className,
      )}
      aria-label={
        expired
          ? "Battle window ended"
          : `Time remaining ${formatRemaining(remainingSec)}`
      }
    >
      <Clock className="h-3.5 w-3.5" />
      {expired ? "ENDED" : formatRemaining(remainingSec)}
    </div>
  );
}

function formatRemaining(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
