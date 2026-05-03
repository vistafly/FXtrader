import type { Bar } from "@/types/bar";
import type { ReplayEngine } from "@/lib/engine/ReplayEngine";

import { BundledDataProvider } from "./BundledDataProvider";

/**
 * Wraps a BundledDataProvider with replay-aware subscribeBars: in replay mode,
 * "real-time" ticks are driven by the ReplayEngine clock, not the network.
 *
 * Per spec §7.5: same UDF surface as the underlying provider; only subscribeBars
 * behavior changes — the replay engine's bar events are forwarded to all
 * subscribers whose symbol matches.
 */
export class ReplayDataProvider extends BundledDataProvider {
  private engineUnsub: (() => void) | null = null;
  private currentSymbol: string | null = null;

  /**
   * Bind this provider to a ReplayEngine instance for a given symbol. While
   * bound, every "bar" event from the engine is forwarded to subscribeBars
   * listeners for that symbol.
   */
  bindEngine(engine: ReplayEngine, symbol: string): void {
    this.unbindEngine();
    this.currentSymbol = symbol;
    this.engineUnsub = engine.subscribe((event) => {
      if (event.type !== "bar" || this.currentSymbol === null) return;
      this.dispatch(this.currentSymbol, event.bar);
    });
  }

  unbindEngine(): void {
    if (this.engineUnsub) this.engineUnsub();
    this.engineUnsub = null;
    this.currentSymbol = null;
  }

  private dispatch(symbol: string, bar: Bar): void {
    this.pushTick(symbol, bar);
  }
}
