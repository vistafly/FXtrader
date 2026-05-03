import type { Bar } from "@/types/bar";

import { aggregateBars } from "./aggregateBars";
import type {
  DataProvider,
  DatafeedConfiguration,
  GetBarsResult,
  LibrarySymbolInfo,
  PeriodParams,
  ResolutionString,
  SearchSymbolResult,
} from "./DataProvider";

interface ManifestAsset {
  symbol: string;
  fileSlug: string;
  class: "forex" | "futures";
  source: "synthetic" | "dukascopy" | "yahoo";
  timeframes: ["1m"];
  startTime: number;
  endTime: number;
  barCount: number;
  fileSize: number;
}

interface Manifest {
  version: number;
  syntheticSeed: string;
  windowEnd: string;
  windowDays: number;
  generatedAt: string | null;
  assets: ManifestAsset[];
}

const SUPPORTED_RESOLUTIONS: ResolutionString[] = [
  "1",
  "5",
  "15",
  "60",
  "240",
  "1D",
];

function resolutionToMinutes(r: ResolutionString): number {
  if (r === "1D") return 1440;
  const n = Number(r);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Unsupported resolution: ${r}`);
  }
  return n;
}

async function loadGzippedJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error(`fetch ${url} → empty body`);
  const ds = new DecompressionStream("gzip");
  const stream = res.body.pipeThrough(ds);
  const text = await new Response(stream).text();
  return JSON.parse(text) as T;
}

interface Subscription {
  symbol: string;
  resolution: ResolutionString;
  onTick: (bar: Bar) => void;
}

/**
 * Reads bundled gzipped JSON datasets produced by `pnpm fetch-data`.
 * Implements the UDF-shaped contract from spec §7.5.
 *
 * subscribeBars stores callbacks but does not push ticks itself — replay
 * driving lives in `ReplayDataProvider`, which wraps this and forwards
 * `ReplayEngine` bar events to the registered listeners.
 */
export class BundledDataProvider implements DataProvider {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private manifest: Manifest | null = null;
  private barCache = new Map<string, Bar[]>();
  protected listeners = new Map<string, Subscription>();

  constructor(opts: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = opts.baseUrl ?? "/data";
    // `fetch` requires `Window` as its `this`. Stripping the binding by
    // assigning it to an object property means a later `this.fetchFn(url)` call
    // throws "Illegal invocation". Re-bind on construction.
    this.fetchFn = opts.fetch ?? fetch.bind(globalThis);
  }

  async onReady(): Promise<DatafeedConfiguration> {
    return {
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
      exchanges: [
        { value: "FX", name: "FX", desc: "Spot Forex" },
        { value: "CME", name: "CME", desc: "CME Equity Index Futures" },
      ],
      symbols_types: [
        { name: "Forex", value: "forex" },
        { name: "Futures", value: "futures" },
      ],
    };
  }

  async searchSymbols(
    userInput: string,
    _exchange: string,
    symbolType: string,
  ): Promise<SearchSymbolResult[]> {
    const manifest = await this.getManifest();
    const q = userInput.toLowerCase();
    return manifest.assets
      .filter(
        (a) =>
          (!q || a.symbol.toLowerCase().includes(q)) &&
          (!symbolType || a.class === symbolType),
      )
      .map((a) => ({
        symbol: a.symbol,
        full_name: a.symbol,
        description: a.symbol,
        exchange: a.class === "forex" ? "FX" : "CME",
        ticker: a.symbol,
        type: a.class,
      }));
  }

  async resolveSymbol(symbolName: string): Promise<LibrarySymbolInfo> {
    const manifest = await this.getManifest();
    const a = manifest.assets.find((x) => x.symbol === symbolName);
    if (!a) throw new Error(`unknown_symbol: ${symbolName}`);

    return {
      ticker: a.symbol,
      name: a.symbol,
      description: a.symbol,
      type: a.class,
      session: a.class === "forex" ? "2200-2200:23456" : "2200-2100:23456",
      timezone: "Etc/UTC",
      exchange: a.class === "forex" ? "FX" : "CME",
      minmov: 1,
      pricescale: a.class === "forex" ? 100_000 : 100,
      has_intraday: true,
      has_daily: true,
      supported_resolutions: SUPPORTED_RESOLUTIONS,
      data_status: "endofday",
    };
  }

  async getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
  ): Promise<GetBarsResult> {
    const allBars = await this.loadAllBars(symbolInfo.ticker);
    const tfMin = resolutionToMinutes(resolution);
    const series = tfMin === 1 ? allBars : aggregateBars(allBars, tfMin);

    const bars = series.filter(
      (b) => b.time >= periodParams.from && b.time < periodParams.to,
    );

    return {
      bars,
      meta: {
        noData: bars.length === 0,
        // nextTime intentionally undefined — see DataProvider.ts comment + spec §7.5.
      },
    };
  }

  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: (bar: Bar) => void,
    listenerGuid: string,
  ): void {
    this.listeners.set(listenerGuid, {
      symbol: symbolInfo.ticker,
      resolution,
      onTick,
    });
  }

  unsubscribeBars(listenerGuid: string): void {
    this.listeners.delete(listenerGuid);
  }

  // ---- Provider extensions (used by ReplayDataProvider + tests) -----------

  /** Fetch and cache the full 1m series for a symbol. */
  async loadAllBars(ticker: string): Promise<Bar[]> {
    const cached = this.barCache.get(ticker);
    if (cached) return cached;

    const manifest = await this.getManifest();
    const asset = manifest.assets.find((a) => a.symbol === ticker);
    if (!asset) throw new Error(`unknown_symbol: ${ticker}`);

    const url = `${this.baseUrl}/${asset.fileSlug}_1m.json.gz`;
    const bars = await loadGzippedJson<Bar[]>(url, this.fetchFn);
    this.barCache.set(ticker, bars);
    return bars;
  }

  async getManifest(): Promise<Manifest> {
    if (this.manifest) return this.manifest;
    const url = `${this.baseUrl}/manifest.json`;
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`fetch ${url} → ${res.status} ${res.statusText}`);
    this.manifest = (await res.json()) as Manifest;
    return this.manifest;
  }

  /** For tests / ReplayDataProvider: push a tick to all subscribers of `symbol`. */
  pushTick(symbol: string, bar: Bar): void {
    for (const sub of this.listeners.values()) {
      if (sub.symbol === symbol) sub.onTick(bar);
    }
  }
}
