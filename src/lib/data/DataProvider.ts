/**
 * UDF-shaped datafeed contract. Per spec §7.5, this interface is intentionally
 * shaped after TradingView's UDF protocol so the future swap to TV's Trading
 * Platform library is mechanical.
 *
 * One deviation from raw UDF: methods return Promises instead of taking
 * callbacks. The adapter that wraps this for TV will translate Promise → callback
 * at the boundary. Keeping the internal API Promise-based is much easier for our
 * own callers (Zustand actions, async React components).
 *
 * Time convention: our domain `Bar.time` is **Unix seconds**. TV uses
 * milliseconds. Conversion happens at the TV adapter, never inside this
 * provider.
 */
import type { Bar } from "@/types/bar";

export type ResolutionString = "1" | "5" | "15" | "60" | "240" | "1D" | string;

export interface DatafeedConfiguration {
  supported_resolutions: ResolutionString[];
  supports_marks: boolean;
  supports_timescale_marks: boolean;
  supports_time: boolean;
  exchanges: { value: string; name: string; desc: string }[];
  symbols_types: { name: string; value: string }[];
}

export interface LibrarySymbolInfo {
  ticker: string;
  name: string;
  description: string;
  type: string; // 'forex', 'futures'
  session: string; // '24x7' for forex, '0930-1600' for stocks, etc.
  timezone: string;
  exchange: string;
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  supported_resolutions: ResolutionString[];
  data_status: "streaming" | "endofday" | "pulsed" | "delayed_streaming";
}

export interface SearchSymbolResult {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: string;
}

export interface PeriodParams {
  from: number; // Unix seconds inclusive
  to: number; // Unix seconds exclusive
  countBack: number;
  firstDataRequest: boolean;
}

export interface GetBarsResult {
  bars: Bar[]; // ascending by time
  meta: {
    noData: boolean;
    /**
     * Hint indicating older data exists at-or-before this Unix-second timestamp.
     * Per spec §7.5 + UDF docs: leave undefined unless the provider can cheaply
     * confirm older data is available.
     */
    nextTime?: number;
  };
}

export interface DataProvider {
  /** Maps to UDF onReady(). Returns supported resolutions + exchange list. */
  onReady(): Promise<DatafeedConfiguration>;

  /** Maps to UDF searchSymbols(). */
  searchSymbols(
    userInput: string,
    exchange: string,
    symbolType: string,
  ): Promise<SearchSymbolResult[]>;

  /** Maps to UDF resolveSymbol(). */
  resolveSymbol(symbolName: string): Promise<LibrarySymbolInfo>;

  /** Maps to UDF getBars(). Returns historical bars in ascending time order. */
  getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
  ): Promise<GetBarsResult>;

  /**
   * Maps to UDF subscribeBars(). In replay mode, ticks come from the
   * ReplayEngine clock, not the network. The implementation is a pure
   * dispatcher — it stores the callback and replays bar events to it.
   */
  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: (bar: Bar) => void,
    listenerGuid: string,
  ): void;

  /** Maps to UDF unsubscribeBars(). */
  unsubscribeBars(listenerGuid: string): void;
}
