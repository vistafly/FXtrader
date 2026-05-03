"use client";

import { useEffect, useState } from "react";

import { ChartContainer } from "@/components/chart/ChartContainer";
import { ReplayControls } from "@/components/replay/ReplayControls";
import { ScrubberBar } from "@/components/replay/ScrubberBar";
import { Button } from "@/components/ui/button";
import { BundledDataProvider } from "@/lib/data/BundledDataProvider";
import type { ResolutionString } from "@/lib/data/DataProvider";
import { cn } from "@/lib/utils";
import { useReplayStore } from "@/stores/replayStore";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "NQ1!", "ES1!"] as const;

const TIMEFRAMES: { label: string; value: ResolutionString }[] = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "1D" },
];

export default function TradeDemoPage() {
  const [symbol, setSymbol] = useState<(typeof SYMBOLS)[number]>("EURUSD");
  const [resolution, setResolution] = useState<ResolutionString>("1");
  // `loadedKey` is the symbol+resolution whose bars are currently seated in the engine.
  // We derive `loading` rather than imperatively setting it in the effect.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const key = `${symbol}/${resolution}`;

  useEffect(() => {
    let cancelled = false;
    const provider = new BundledDataProvider({ baseUrl: "/data" });
    useReplayStore
      .getState()
      .loadInstrument(provider, symbol, resolution)
      .then(() => {
        if (cancelled) return;
        setError(null);
        setLoadedKey(`${symbol}/${resolution}`);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });

    return () => {
      cancelled = true;
      // Halt playback on unmount so the engine doesn't keep ticking after navigation.
      useReplayStore.getState().pause();
    };
  }, [symbol, resolution]);

  const loading = loadedKey !== key && !error;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">FXTrader</h1>
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Phase 4 demo · {symbol}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5 font-mono text-xs">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setResolution(tf.value)}
                className={cn(
                  "rounded px-2 py-1 transition-colors",
                  resolution === tf.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={resolution === tf.value}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {SYMBOLS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={s === symbol ? "default" : "ghost"}
                onClick={() => setSymbol(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <section className="relative flex-1 bg-background">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-muted-foreground">
            loading {symbol} {TIMEFRAMES.find((t) => t.value === resolution)?.label}…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-destructive">
            {error}
          </div>
        )}
        <ChartContainer symbol={symbol} />
      </section>

      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card/50 px-4 py-2">
        <ReplayControls
          timeframeMinutes={resolution === "1D" ? 1440 : Number(resolution) || 1}
          className="ml-auto"
        />
      </div>
      <ScrubberBar />
    </main>
  );
}
