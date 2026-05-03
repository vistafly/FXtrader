/**
 * Builds /public/data/{SYMBOL}_1m.json.gz + manifest.json.
 *
 * Default ("pnpm fetch-data"): deterministic synthetic generator. No network.
 *   Anchored to a fixed UTC window (see WINDOW_END_ISO) so output is
 *   byte-identical on every machine.
 *
 * --real: tries dukascopy-node (forex) and yahoo-finance2 (futures); falls
 *   back to synthetic per-instrument on any failure. manifest.json records
 *   the actual source used per dataset.
 */

import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as dukascopy from "dukascopy-node";
import YahooFinance from "yahoo-finance2";

// yahoo-finance2 v3 requires explicit instantiation.
const yahooFinance = new YahooFinance();

import type { Bar } from "../src/types/bar.ts";

// ---- Determinism --------------------------------------------------------

/**
 * Synthetic-mode random seed. CHECKED-IN CONSTANT — do not change without
 * also bumping the manifest version. Picking a deterministic seed is what
 * lets `pnpm fetch-data` produce byte-identical files across machines, which
 * the Phase 3 Definition of Done requires.
 *
 * Hex 0x46585452 spells "FXTR" in ASCII.
 */
const SYNTHETIC_SEED = 0x46585452;

/**
 * Fixed 30-day UTC window. Anchored to a Friday 22:00 UTC (forex weekly close)
 * so both forex and futures session calendars terminate cleanly inside it.
 * Bumping these dates invalidates the determinism guarantee — only do it on
 * a manifest version bump.
 */
const WINDOW_END_ISO = "2026-04-24T22:00:00Z";
const WINDOW_DAYS = 30;

// ---- Instruments to build ----------------------------------------------

interface BuildSpec {
  symbol: string;
  fileSlug: string; // safe filename portion (NQ1!→NQ1)
  class: "forex" | "futures";
  startPrice: number;
  /** Annualized volatility used by the GBM walk (e.g. 0.07 = 7%/yr). */
  volPctPerYear: number;
  decimals: number;
}

const INSTRUMENTS: BuildSpec[] = [
  { symbol: "EURUSD", fileSlug: "EURUSD", class: "forex", startPrice: 1.085, volPctPerYear: 0.07, decimals: 5 },
  { symbol: "GBPUSD", fileSlug: "GBPUSD", class: "forex", startPrice: 1.265, volPctPerYear: 0.08, decimals: 5 },
  { symbol: "USDJPY", fileSlug: "USDJPY", class: "forex", startPrice: 152.4, volPctPerYear: 0.09, decimals: 3 },
  { symbol: "NQ1!", fileSlug: "NQ1", class: "futures", startPrice: 18250, volPctPerYear: 0.20, decimals: 2 },
  { symbol: "ES1!", fileSlug: "ES1", class: "futures", startPrice: 5180, volPctPerYear: 0.16, decimals: 2 },
];

// ---- Session calendars --------------------------------------------------

/**
 * @param ts Unix seconds.
 * @returns true if this minute is part of the active forex session.
 *
 * Forex week: Sun 22:00 UTC → Fri 22:00 UTC. No Saturday bars.
 */
function isForexSessionMinute(ts: number): boolean {
  const d = new Date(ts * 1000);
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  const hour = d.getUTCHours();

  if (day === 6) return false; // Saturday closed
  if (day === 0 && hour < 22) return false; // Sunday before 22:00 UTC
  if (day === 5 && hour >= 22) return false; // Friday after 22:00 UTC
  return true;
}

/**
 * @param ts Unix seconds.
 * @returns true if this minute is part of the active CME equity-index futures session.
 *
 * CME globex: Sun 22:00 UTC → Fri 21:00 UTC, with a daily 21:00–22:00 UTC
 * maintenance break Mon–Thu.
 */
function isFuturesSessionMinute(ts: number): boolean {
  const d = new Date(ts * 1000);
  const day = d.getUTCDay();
  const hour = d.getUTCHours();

  if (day === 6) return false; // Saturday closed
  if (day === 0 && hour < 22) return false; // Sunday pre-open
  if (day === 5 && hour >= 21) return false; // Friday after 21:00 UTC close
  if (day >= 1 && day <= 4 && hour === 21) return false; // Mon-Thu maintenance break
  return true;
}

function isSessionMinute(spec: BuildSpec, ts: number): boolean {
  return spec.class === "forex" ? isForexSessionMinute(ts) : isFuturesSessionMinute(ts);
}

// ---- Synthetic generator (deterministic LCG) ----------------------------

/**
 * Linear congruential generator. Same algorithm as Java's java.util.Random
 * truncated to 32 bits. Pure function of seed history — given identical
 * seeds it yields identical sequences across V8 versions.
 */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Box-Muller transform → standard normal sample. */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function generateSyntheticBars(
  spec: BuildSpec,
  startTs: number,
  endTs: number,
): Bar[] {
  // Combine the global seed with a per-instrument salt so changing INSTRUMENTS
  // order doesn't shuffle each pair's bar history.
  const symbolSalt = [...spec.symbol].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 0);
  const rng = makeLcg(SYNTHETIC_SEED ^ (symbolSalt >>> 0));

  // GBM volatility scaled to per-minute. Approx 525,600 minutes/year → sigma_minute = sigma_year / sqrt(525600).
  const sigmaMinute = spec.volPctPerYear / Math.sqrt(525_600);
  // Drift: keep close to zero so prices don't run off.
  const muMinute = 0;

  const bars: Bar[] = [];
  let close = spec.startPrice;
  const factor = 10 ** spec.decimals;
  const round = (n: number) => Math.round(n * factor) / factor;

  for (let ts = startTs; ts < endTs; ts += 60) {
    if (!isSessionMinute(spec, ts)) continue;

    const open = close;
    const drift = muMinute - 0.5 * sigmaMinute * sigmaMinute;
    const shock = sigmaMinute * gaussian(rng);
    const next = open * Math.exp(drift + shock);
    close = round(next);

    // Intra-bar range: small additional noise above/below the open-close span
    const span = Math.abs(close - open);
    const noise = sigmaMinute * open * 0.5;
    const high = round(Math.max(open, close) + Math.abs(gaussian(rng)) * noise);
    const low = round(Math.min(open, close) - Math.abs(gaussian(rng)) * noise);

    bars.push({
      time: ts,
      open: round(open),
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Math.floor(rng() * 900 + 100),
    });

    // Guardrail: prevent runaway prices (rare with low vol, but keeps tests sane).
    if (Math.abs(Math.log(close / spec.startPrice)) > 0.5) {
      close = spec.startPrice * Math.exp(Math.log(close / spec.startPrice) * 0.5);
    }
    if (span > spec.startPrice * 0.05) {
      // Prevent extreme single-bar moves
      close = open;
    }
  }

  return bars;
}

// ---- Real-mode adapters -------------------------------------------------

async function fetchForexBarsDukascopy(
  symbol: string,
  startTs: number,
  endTs: number,
): Promise<Bar[]> {
  // dukascopy-node's Instrument enum keys are lowercased symbol names.
  type DkInstrument = keyof typeof dukascopy.Instrument;
  const key = symbol.toLowerCase() as DkInstrument;
  const instrument = dukascopy.Instrument[key];
  if (!instrument) throw new Error(`Dukascopy: unknown instrument ${symbol}`);

  // Type assertion through unknown — dukascopy-node's typed return shape
  // narrows by overload but its runtime `format: "json"` returns array-of-OHLC.
  const raw = (await dukascopy.getHistoricalRates({
    instrument,
    dates: { from: new Date(startTs * 1000), to: new Date(endTs * 1000) },
    timeframe: dukascopy.Timeframe.m1,
    format: dukascopy.Format.json,
  })) as unknown;

  const rows = raw as Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Dukascopy returned no rows for ${symbol}`);
  }
  return rows.map((r) => ({
    time: Math.floor(r.timestamp / 1000),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

async function fetchFuturesBarsYahoo(
  symbol: string,
  startTs: number,
  endTs: number,
): Promise<Bar[]> {
  // Yahoo's symbol mapping for our notations
  const ymap: Record<string, string> = { "NQ1!": "NQ=F", "ES1!": "ES=F" };
  const ySym = ymap[symbol];
  if (!ySym) throw new Error(`No Yahoo mapping for ${symbol}`);

  interface YahooQuote {
    date: Date | string | number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }
  interface YahooChartResult {
    quotes: YahooQuote[];
  }

  const all: Bar[] = [];
  // Yahoo intraday cap: ~7 days per request. Chunk in 6-day windows to be safe.
  const CHUNK_SEC = 6 * 86_400;
  for (let s = startTs; s < endTs; s += CHUNK_SEC) {
    const e = Math.min(s + CHUNK_SEC, endTs);
    const result = (await yahooFinance.chart(ySym, {
      period1: new Date(s * 1000),
      period2: new Date(e * 1000),
      interval: "1m",
    })) as unknown as YahooChartResult;
    const quotes = result?.quotes ?? [];
    for (const q of quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
      all.push({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      });
    }
  }
  if (all.length === 0) throw new Error(`Yahoo returned no bars for ${symbol}`);
  // Defensive: ensure ascending by time and de-duplicated.
  all.sort((a, b) => a.time - b.time);
  return all.filter((b, i) => i === 0 || b.time !== all[i - 1].time);
}

// ---- Main ---------------------------------------------------------------

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
  generatedAt: string | null; // null in pure-synthetic mode for byte-identical manifests
  assets: ManifestAsset[];
}

async function buildOne(
  spec: BuildSpec,
  startTs: number,
  endTs: number,
  realMode: boolean,
): Promise<{ bars: Bar[]; source: ManifestAsset["source"] }> {
  if (realMode) {
    try {
      console.log(`  ⤷ ${spec.symbol}: trying real source...`);
      const bars =
        spec.class === "forex"
          ? await fetchForexBarsDukascopy(spec.symbol, startTs, endTs)
          : await fetchFuturesBarsYahoo(spec.symbol, startTs, endTs);
      console.log(`  ✓ ${spec.symbol}: ${bars.length} bars from real source.`);
      return { bars, source: spec.class === "forex" ? "dukascopy" : "yahoo" };
    } catch (err) {
      console.warn(
        `  ! ${spec.symbol}: real fetch failed (${(err as Error).message}). Falling back to synthetic.`,
      );
    }
  }
  const bars = generateSyntheticBars(spec, startTs, endTs);
  console.log(`  ✓ ${spec.symbol}: ${bars.length} synthetic bars.`);
  return { bars, source: "synthetic" };
}

async function main() {
  const realMode = process.argv.includes("--real");

  // Optional: --real-window=<days>. Tighter windows raise Yahoo's success rate
  // at the cost of less history. Default stays 30 (matches synthetic).
  const realWindowArg = process.argv.find((a) => a.startsWith("--real-window="));
  const realWindowDays = realWindowArg
    ? Math.max(1, Math.floor(Number(realWindowArg.split("=")[1]) || WINDOW_DAYS))
    : WINDOW_DAYS;

  // Synthetic mode uses the fixed WINDOW_END anchor (deterministic).
  // Real mode uses a rolling now-Nd window so Yahoo's 30-day intraday limit
  // is respected. (Real data isn't byte-stable anyway, so determinism is moot.)
  let endTs: number;
  let startTs: number;
  if (realMode) {
    endTs = Math.floor(Date.now() / 1000);
    startTs = endTs - realWindowDays * 86_400;
  } else {
    endTs = Math.floor(new Date(WINDOW_END_ISO).getTime() / 1000);
    startTs = endTs - WINDOW_DAYS * 86_400;
  }

  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = join(dirname(__filename), "..");
  const outDir = join(projectRoot, "public", "data");
  mkdirSync(outDir, { recursive: true });

  console.log(`fxtrader fetch-data — mode: ${realMode ? "real (with synthetic fallback)" : "synthetic-only"}`);
  console.log(`window: ${new Date(startTs * 1000).toISOString()} → ${new Date(endTs * 1000).toISOString()}`);
  console.log(`output: ${outDir}\n`);

  const assets: ManifestAsset[] = [];
  let allSynthetic = true;

  for (const spec of INSTRUMENTS) {
    const { bars, source } = await buildOne(spec, startTs, endTs, realMode);
    if (source !== "synthetic") allSynthetic = false;

    // Deterministic JSON serialization: no whitespace, fixed key order from Bar shape.
    const json = JSON.stringify(bars);
    const gz = gzipSync(Buffer.from(json, "utf8"), { level: 9 });
    const fileName = `${spec.fileSlug}_1m.json.gz`;
    writeFileSync(join(outDir, fileName), gz);

    assets.push({
      symbol: spec.symbol,
      fileSlug: spec.fileSlug,
      class: spec.class,
      source,
      timeframes: ["1m"],
      startTime: bars[0]?.time ?? startTs,
      endTime: bars[bars.length - 1]?.time ?? endTs,
      barCount: bars.length,
      fileSize: gz.byteLength,
    });
  }

  const manifest: Manifest = {
    version: 1,
    syntheticSeed: `0x${SYNTHETIC_SEED.toString(16).toUpperCase()}`,
    windowEnd: WINDOW_END_ISO,
    windowDays: WINDOW_DAYS,
    // Pure-synthetic mode: omit generatedAt for byte-identical manifest across runs.
    generatedAt: allSynthetic ? null : new Date().toISOString(),
    assets,
  };
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(`\n✓ wrote ${assets.length} datasets + manifest.json`);
  for (const a of assets) {
    console.log(
      `  ${a.symbol.padEnd(8)} ${a.class.padEnd(8)} ${a.source.padEnd(10)} ${a.barCount.toString().padStart(7)} bars  ${(a.fileSize / 1024).toFixed(1).padStart(8)} KB`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
