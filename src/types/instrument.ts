export type InstrumentClass = "forex" | "futures";

/**
 * v2.2.6b: weekly session-hours preset. Used by the closed-market overlay.
 *   - "forex":       open Sun 22:00 UTC → Fri 22:00 UTC (24/5).
 *   - "cme-futures": open Sun 23:00 UTC → Fri 22:00 UTC.
 *
 * Daily maintenance breaks (e.g. CME's 22:00-23:00 UTC weekday window) are
 * NOT modeled — the overlay would flicker for an hour each weekday with
 * little user value. Add a finer-grained preset later if needed.
 *
 * Instruments WITHOUT a preset return `undefined` from `isMarketOpen` —
 * the overlay treats this as "unknown, don't show" rather than a false
 * closed signal.
 */
export type SessionHoursPreset = "forex" | "cme-futures";

export interface Instrument {
  symbol: string;
  displayName: string;
  class: InstrumentClass;
  pipSize: number;
  tickSize: number;
  tickValue: number;
  contractSize: number;
  marginPerContract: number;
  commission: number;
  priceDecimals: number;
  /** Optional. Drives the closed-market overlay; absence ⇒ no overlay. */
  sessionHours?: SessionHoursPreset;
}
