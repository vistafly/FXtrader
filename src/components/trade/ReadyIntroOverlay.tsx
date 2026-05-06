"use client";

import { Swords } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface Props {
  /** Optional battle name shown above the countdown. */
  battleName?: string;
  /** Fires when the 3-2-1 sequence completes and the overlay
   *  has finished its fade-out. */
  onDone: () => void;
}

/**
 * v2.3 sub-phase 3: full-screen "Ready?" intro transition shown
 * on first entry into a server-battle attempt. Per the locked D8
 * decision, this only fires for the FIRST entry — detection is
 * external (caller passes onDone immediately if it's a resume
 * by simply not mounting this component).
 *
 * Sequence:
 *   t=0     Battle name + "Ready?" (200ms hold)
 *   t=0.2s  3 (1s hold)
 *   t=1.2s  2 (1s hold)
 *   t=2.2s  1 (1s hold)
 *   t=3.2s  GO! (400ms fade-out)
 *   t=3.6s  onDone()
 *
 * Big numerals, dark backdrop, monospace, gradient text. Backdrop
 * blocks pointer events so the user can't click through to the
 * trade UI mid-intro.
 */
export function ReadyIntroOverlay({ battleName, onDone }: Props) {
  // Phase enum drives the on-screen content + animation state.
  const [phase, setPhase] = useState<
    "ready" | "three" | "two" | "one" | "go" | "done"
  >("ready");

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase("three"), 200),
      setTimeout(() => setPhase("two"), 1200),
      setTimeout(() => setPhase("one"), 2200),
      setTimeout(() => setPhase("go"), 3200),
      setTimeout(() => setPhase("done"), 3600),
      setTimeout(() => onDone(), 3650),
    ];
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [onDone]);

  if (phase === "done") return null;

  const numeral = (() => {
    switch (phase) {
      case "three":
        return "3";
      case "two":
        return "2";
      case "one":
        return "1";
      case "go":
        return "GO";
      default:
        return "";
    }
  })();

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 backdrop-blur-md transition-opacity duration-400",
        phase === "go" ? "bg-background/80" : "bg-background/95",
      )}
      // High z-index over chart + dialogs; pointer-events default
      // (auto) so the user can't interact with the UI behind.
      role="dialog"
      aria-label="Battle starting"
    >
      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.4em] text-primary/80">
        <Swords className="h-4 w-4" />
        Ready?
      </div>
      {battleName && (
        <h2 className="bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
          {battleName}
        </h2>
      )}
      <div
        // The numeral animates per phase: scale + fade-in. Each
        // phase change re-keys the numeral div so the animation
        // re-runs.
        key={phase}
        className={cn(
          "flex h-40 w-40 items-center justify-center rounded-full border-2 transition-all duration-300 ease-out",
          "bg-gradient-to-br from-primary/15 via-primary/5 to-transparent",
          "border-primary/40 shadow-[0_0_60px_rgba(120,119,198,0.25)]",
          "animate-[readyPulse_300ms_ease-out]",
        )}
      >
        <span
          className={cn(
            "bg-gradient-to-b from-foreground to-primary bg-clip-text text-7xl font-bold tabular-nums text-transparent drop-shadow-lg",
            phase === "go" && "text-6xl",
          )}
        >
          {numeral}
        </span>
      </div>
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
        Match starting
      </p>

      {/* Inline keyframes — Tailwind doesn't ship a "scale + fade in"
          arbitrary animation, so we declare it here. Scoped to the
          overlay only. */}
      <style>{`
        @keyframes readyPulse {
          0% { transform: scale(0.7); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
