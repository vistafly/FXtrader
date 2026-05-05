# FXTrader — Trading Backtesting & Replay Simulator

> **Master spec for Claude Code.** Build the application described below from scratch. Follow this document as the single source of truth. When something is ambiguous, ask before guessing.
>
> **Version 2** — Lightweight Charts foundation with UDF-shaped data layer for future swap to TradingView Trading Platform.

---

## 1. What We're Building

**FXTrader** is a desktop-first web application that lets a single local user replay historical market data candle-by-candle and place simulated trades against it — like a flight simulator for traders. It's heavily inspired by [FXReplay](https://app.fxreplay.com), but free, local, and fully owned by the user.

### Core value proposition
- Pick an asset (e.g. `EURUSD`, `NQ1!`) and a historical date.
- Replay the chart from that point forward at 1×, 2×, 4×, 8×, 16× speed (or scrub manually).
- Place market/limit orders, set stop-loss and take-profit, watch them fill against historical price action.
- Track P&L, win rate, time played, win streaks, and full trade history per "session."
- Compete with yourself via "Battles" (gamified backtesting sessions with leaderboards and streaks).

### What this is NOT
- ❌ Not a live trading platform — orders are simulated only.
- ❌ Not multi-user — single local user, no auth, no cloud (v1).
- ❌ Not a strategy backtester (no algo/scripted strategies in v1) — purely manual discretionary replay.
- ❌ Not connected to real broker APIs.

### Future state (post-v1, optional)
- Public deployment with multi-user accounts
- Swap to TradingView **Trading Platform** library for in-chart order placement (see §18)
- More instruments, longer history, more timeframes

---

## Status

v1 complete as of 2026-05-03. Built across 8 phases following §12. All §15 DoD criteria met. Test count: 99 passing. Production build clean. See git history (commits 4c09990 → 85e3ca2) for phase-by-phase progression. Future work tracked in the README roadmap and §18 (TradingView Trading Platform swap path).

---

## 2. Tech Stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 14+ (App Router)** | SSR-ready for future multi-user, great DX, file-based routing |
| Language | **TypeScript (strict mode)** | Type safety is non-negotiable for a financial app |
| Styling | **Tailwind CSS** + **shadcn/ui** | shadcn gives professional primitives; Tailwind for everything else |
| Charts | **Lightweight Charts v4** (TradingView, Apache 2.0) | Free, full replay control, swap-ready |
| State | **Zustand** | Simpler than Redux, perfect for local-only app |
| Persistence | **IndexedDB via Dexie.js** | Client-side DB, handles large historical datasets |
| Data fetching | **TanStack Query** | For any future remote data sources |
| Forms | **React Hook Form + Zod** | Order entry form validation |
| Icons | **Lucide React** | Matches FXReplay's icon vibe |
| Tables | **TanStack Table v8** | Position tables, trade history, leaderboards |
| Date/time | **date-fns** | Lightweight, immutable |
| Testing | **Vitest** + **React Testing Library** | Critical for the matching engine |

> **Do not** add Redux, Material-UI, Chakra, Bootstrap, or styled-components. **Do not** introduce a backend in v1 — everything runs in the browser.

### §2.1 Stack Notes (actual — Phase 1 install)

What is actually installed on disk in `fxtrader/`. The table above is the spec; this is reality. Future phases reference this section, not the spec's original assumptions.

| Layer | Actual |
|---|---|
| Runtime — Node.js | **22.18.0** |
| Package manager | **pnpm 10.33.2** |
| Framework | **Next.js 16.2.4** (App Router, Turbopack dev) — spec said "14+", 16 is in-bounds |
| React | **19.2.4** |
| Language | TypeScript 5.x (strict) |
| Styling | **Tailwind CSS 3.4.x** — downgraded from auto-generated v4 to match DESIGN_SYSTEM.md's v3 syntax and shadcn v2 expectations. PostCSS + Autoprefixer wired up. |
| UI primitives | **shadcn/ui pinned to ^2.10.0** — `style: "new-york"`, `baseColor: "neutral"`, CSS variables on. Configured via `components.json` (style flag was removed from CLI in shadcn 2.10). |
| State | Zustand 5.x (settings store uses persist → localStorage) |
| Persistence | Dexie 4.x — schema defined for `sessions`, `orders`, `positions`, `trades`, `battles`, `battleAttempts`, `bars` with composite indexes |
| Charts | **Not yet installed.** `lightweight-charts` lands in Phase 4. |
| Data fetching | TanStack Query 5.x |
| Forms | React Hook Form 7.x + Zod 4.x + `@hookform/resolvers` 5.x |
| Tables | TanStack Table 8.x |
| Date/time | date-fns 4.x |
| Icons | lucide-react 1.x |
| Testing | Vitest 4.x + jsdom 29 + @testing-library/react 16 + @testing-library/jest-dom 6 + @vitejs/plugin-react 6 |
| Data fetch script (devDeps, scripts/ only) | tsx 4.x + dukascopy-node 1.46.x (forex) + yahoo-finance2 3.14.x (futures) — never imported by app runtime |

**Notable deviations from §2:**
1. **Tailwind v3 not v4.** v4 moves config into CSS `@theme` blocks — incompatible with the `tailwind.config.ts` snippet in DESIGN_SYSTEM.md and unsupported by shadcn v2 components. Pinned `tailwindcss@^3`.
2. **shadcn pinned to v2.x.** Latest (v4) removed the "new-york" style entirely. Pinning preserves DESIGN_SYSTEM.md's information-density baseline.
3. **Next 16 / React 19 instead of 14 / 18.** create-next-app gave us the latest. Both stable; spec says "Next.js 14+" so 16 is permitted.
4. **`lightweight-charts` deferred to Phase 4** (its actual phase) rather than installed in Phase 1.

### Future-proofing constraints (critical)
- The chart is wrapped in a `<ChartProvider>` interface so we can swap Lightweight Charts → TradingView Trading Platform library without touching consumers. **See §18 for the swap path.**
- The data layer (`DataProvider`) is shaped after **TradingView's UDF (Universal Datafeed) protocol** so it plugs into any of the three TradingView libraries. **See §7.5.**
- Persistence is wrapped in a `repository/` layer so IndexedDB → Postgres/Supabase migration is a one-file change.

---

## 3. Project Structure

```
fxtrader/
├── public/
│   ├── data/
│   │   ├── EURUSD_1m.json.gz       # Pre-bundled sample datasets
│   │   ├── GBPUSD_1m.json.gz
│   │   ├── USDJPY_1m.json.gz
│   │   ├── NQ1_1m.json.gz
│   │   ├── ES1_1m.json.gz
│   │   └── manifest.json            # Lists available assets + their date ranges
│   └── icons/                       # Custom SVGs (sword, fire, etc.)
├── src/
│   ├── app/                         # Next.js App Router
│   │   ├── (dashboard)/
│   │   │   └── page.tsx             # Dashboard route (Dash view)
│   │   ├── trade/
│   │   │   └── [sessionId]/
│   │   │       └── page.tsx         # Active replay session (Trader view)
│   │   ├── battles/
│   │   │   ├── page.tsx             # Battles lobby
│   │   │   └── [battleId]/page.tsx
│   │   ├── journal/
│   │   │   └── page.tsx             # Trade analytics
│   │   ├── settings/
│   │   │   └── page.tsx             # Defaults, data import
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   └── providers.tsx
│   ├── components/
│   │   ├── chart/
│   │   │   ├── ChartContainer.tsx          # Wraps the chart provider
│   │   │   ├── LightweightChartProvider.tsx
│   │   │   ├── ChartProvider.types.ts      # Interface (for future TV swap)
│   │   │   └── overlays/
│   │   │       ├── PositionLine.tsx        # Entry, SL, TP horizontal lines
│   │   │       └── OrderMarker.tsx         # Buy/sell triangles on chart
│   │   ├── trade/
│   │   │   ├── QuickBuySellPanel.tsx
│   │   │   ├── PlaceOrderDialog.tsx
│   │   │   ├── OpenPositionsTable.tsx
│   │   │   ├── ClosedPositionsTable.tsx
│   │   │   └── PositionRow.tsx
│   │   ├── replay/
│   │   │   ├── ReplayControls.tsx
│   │   │   ├── ReplayTimeline.tsx
│   │   │   └── SpeedSelector.tsx
│   │   ├── dashboard/
│   │   │   ├── StatsCard.tsx
│   │   │   ├── BattlesSummary.tsx
│   │   │   ├── TraderKindBadge.tsx
│   │   │   ├── UserOverview.tsx
│   │   │   └── RecentSessionsTable.tsx
│   │   ├── battles/
│   │   │   ├── BattleCard.tsx
│   │   │   ├── Leaderboard.tsx
│   │   │   └── StreakDisplay.tsx
│   │   ├── journal/
│   │   │   ├── EquityCurveChart.tsx
│   │   │   ├── WinLossPie.tsx
│   │   │   └── TradeListFilters.tsx
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── RightSidebar.tsx
│   │   └── ui/                              # shadcn/ui primitives
│   ├── lib/
│   │   ├── engine/
│   │   │   ├── ReplayEngine.ts
│   │   │   ├── MatchingEngine.ts
│   │   │   ├── AccountEngine.ts
│   │   │   └── engine.test.ts
│   │   ├── repository/
│   │   │   ├── db.ts                        # Dexie DB definition
│   │   │   ├── SessionRepository.ts
│   │   │   ├── TradeRepository.ts
│   │   │   ├── BattleRepository.ts
│   │   │   └── BarRepository.ts
│   │   ├── data/
│   │   │   ├── DataProvider.ts              # UDF-shaped interface (§7.5)
│   │   │   ├── BundledDataProvider.ts
│   │   │   ├── ReplayDataProvider.ts        # Replay-aware wrapper
│   │   │   ├── aggregateBars.ts             # 1m → 5m/15m/1h/4h/1d
│   │   │   └── importers/
│   │   │       ├── DukascopyImporter.ts
│   │   │       └── BinanceImporter.ts
│   │   ├── instruments/
│   │   │   ├── instruments.ts               # EURUSD, NQ1, etc. specs
│   │   │   └── contractSpecs.ts             # Pip values, tick sizes, margin
│   │   ├── analytics/
│   │   │   ├── stats.ts                     # Win rate, expectancy, drawdown
│   │   │   └── trader-kind.ts               # "Day Trader" / "Swing" classifier
│   │   ├── format.ts                        # Money, pips, percent formatters
│   │   └── utils.ts                         # cn(), shadcn helper
│   ├── stores/
│   │   ├── replayStore.ts                   # Current bar, speed, isPlaying
│   │   ├── sessionStore.ts                  # Active session, account state
│   │   ├── orderStore.ts                    # Pending orders, positions
│   │   └── settingsStore.ts                 # Theme, default lot size, etc.
│   ├── types/
│   │   ├── instrument.ts
│   │   ├── order.ts
│   │   ├── position.ts
│   │   ├── trade.ts
│   │   ├── session.ts
│   │   ├── battle.ts
│   │   └── bar.ts
│   └── hooks/
│       ├── useReplayClock.ts
│       ├── usePosition.ts
│       └── useKeyboardShortcuts.ts
├── scripts/
│   └── fetch-sample-data.ts                 # Node script: build /public/data/
├── tests/
│   └── engine/
│       └── matching.test.ts
├── .gitignore
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json                            # strict: true
├── package.json
└── README.md
```

---

## 4. Domain Model (Types)

> Define these in `src/types/` first. Every other piece of code references them.

```typescript
// types/bar.ts
export interface Bar {
  time: number;        // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// types/instrument.ts
export type InstrumentClass = 'forex' | 'futures';

export interface Instrument {
  symbol: string;              // 'EURUSD', 'NQ1!'
  displayName: string;         // 'EUR/USD', 'Nasdaq 100 Futures'
  class: InstrumentClass;
  pipSize: number;             // 0.0001 for EURUSD, 0.25 for NQ
  tickSize: number;
  tickValue: number;           // USD per tick per contract
  contractSize: number;        // 100000 for forex standard lot, 20 for NQ
  marginPerContract: number;   // simulated initial margin
  commission: number;          // per side, per contract
  priceDecimals: number;       // for display formatting
}

// types/order.ts
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop';
export type OrderStatus = 'pending' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  type: OrderType;
  size: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  status: OrderStatus;
  createdAt: number;           // Unix seconds, simulated time
  filledAt?: number;
  filledPrice?: number;
  rejectionReason?: string;
}

// types/position.ts
export interface Position {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  takeProfit?: number;
  stopLoss?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  commission: number;
  status: 'open' | 'closed';
  closedAt?: number;
  closePrice?: number;
  closeReason?: 'manual' | 'tp' | 'sl' | 'liquidated';
}

// types/trade.ts (a closed position, immutable record)
export interface Trade {
  id: string;
  sessionId: string;
  instrument: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  entryTime: number;
  exitPrice: number;
  exitTime: number;
  pnl: number;
  pips: number;
  commission: number;
  duration: number;
  closeReason: 'manual' | 'tp' | 'sl' | 'liquidated';
  notes?: string;
  tags?: string[];
}

// types/session.ts
export interface Session {
  id: string;
  name: string;
  instrument: string;
  startBarTime: number;
  currentBarTime: number;
  endBarTime?: number;
  startingBalance: number;
  currentBalance: number;
  createdAt: number;
  lastPlayedAt: number;
  status: 'active' | 'paused' | 'ended';
  speedSetting: 1 | 2 | 4 | 8 | 16;
}

// types/battle.ts
export interface Battle {
  id: string;
  name: string;
  instrument: string;
  startBarTime: number;
  durationBars: number;
  startingBalance: number;
  rules: {
    maxDrawdownPct?: number;
    maxLossPerTradePct?: number;
    requireStopLoss?: boolean;
  };
  attempts: BattleAttempt[];
}

export interface BattleAttempt {
  id: string;
  battleId: string;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
  completedAt: number;
}
```

---

## 4.1 Test coverage policy

Test what's testable in the chosen test environment. Engine logic, pure functions, and data transforms are fully tested in Vitest. Canvas-rendering and live browser-only behaviors (chart paint, frame timing) are deferred to Playwright E2E in a later polish phase. Do not write tests that don't actually exercise the behavior they claim to test (e.g. JSDOM canvas tests). Honest "I can't test this in this environment" is preferred over false-confidence tests.

---

## 5. The Replay Engine (Heart of the App)

This is the most important piece. **Build and unit-test this first**, before any UI.

### Concept
The engine has its own simulated clock that ticks forward through historical bars. The UI subscribes to clock events and re-renders. The chart shows only bars where `bar.time <= currentBarTime`.

### `ReplayEngine` API

```typescript
class ReplayEngine {
  private bars: Bar[];
  private currentIndex: number;
  private speed: 1 | 2 | 4 | 8 | 16;
  private isPlaying: boolean;
  private subscribers: Set<(event: ReplayEvent) => void>;
  private timerId: number | null;

  load(bars: Bar[], startIndex: number): void;
  play(): void;
  pause(): void;
  step(direction: 'forward' | 'back'): void;
  setSpeed(speed: 1 | 2 | 4 | 8 | 16): void;
  seekToTime(unixSeconds: number): void;
  seekToIndex(index: number): void;

  getCurrentBar(): Bar;
  getVisibleBars(): Bar[];
  getCurrentPrice(): number;

  subscribe(fn: (event: ReplayEvent) => void): () => void;
}

type ReplayEvent =
  | { type: 'bar'; bar: Bar; index: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; index: number }
  | { type: 'speed'; speed: number }
  | { type: 'end' };
```

### Tick scheduling
- Base interval is **1000ms per bar at 1× speed**.
- At 2× → 500ms, 4× → 250ms, 8× → 125ms, 16× → 62.5ms.
- Use `setTimeout` (recursive) not `setInterval`. Pause waits for the current tick to complete; never mid-tick. Speed changes are immediate — cancel the in-flight timer and reschedule at the new interval. Seek is also immediate. This asymmetry is intentional: pause should not skip a bar's matching-engine processing, but speed changes are pure UX and should feel responsive.

### Intra-bar simulation (important!)
For TP/SL to fill realistically, when a bar advances, the matching engine processes it in this order:

1. **Open** — at `bar.open`, check pending limit/stop orders that would trigger at open.
2. **Path simulation** — assume the bar traveled `open → high → low → close` if `close >= open`, else `open → low → high → close`. (Standard backtester convention.)
3. For each open position, check if the bar's `high` or `low` touched its TP or SL → fill at that price.
4. For each pending limit/stop order, check if the bar's range crossed the trigger → fill.
5. **Close** — finalize remaining unrealized P&L at `bar.close`.

### Subscriptions
The chart, position table, P&L widget, and quick-buy panel all subscribe via Zustand selectors that derive from the replay store. **Never** pass the engine instance into components — always go through the store.

---

## 6. The Matching Engine

`MatchingEngine.ts` is a pure function module (no class state):

```typescript
processBar(input: {
  bar: Bar;
  pendingOrders: Order[];
  openPositions: Position[];
  instrument: Instrument;
}): {
  fills: Fill[];
  closures: PositionClosure[];
  rejections: OrderRejection[];
}
```

### Fill rules

- **Market order**: fills at `bar.open` (the next bar after submission). No mid-bar market fills.
- **Limit buy**: fills if `bar.low <= limitPrice` → fill at `min(limitPrice, bar.open)`.
- **Limit sell**: fills if `bar.high >= limitPrice` → fill at `max(limitPrice, bar.open)`.
- **Stop buy**: fills if `bar.high >= stopPrice` → fill at `max(stopPrice, bar.open)`.
- **Stop sell**: fills if `bar.low <= stopPrice` → fill at `min(stopPrice, bar.open)`.
- **TP/SL on positions**: same as limit/stop logic.
- **TP and SL both hit in same bar**: **SL fills first** (worst case). Document this in code comments.

### P&L formula

```
For forex (per pip):
  pnl = (exitPrice - entryPrice) / pipSize * pipValue * size * direction
  where direction = +1 for buy, -1 for sell

For futures (per tick):
  pnl = (exitPrice - entryPrice) / tickSize * tickValue * contracts * direction

commission = instrument.commission * size * 2   // round-turn
realizedPnl = pnl - commission
```

### Liquidation
If `currentBalance + totalUnrealizedPnl < 0`, liquidate all open positions at the current bar's close. Prevents the simulator from going to negative infinity.

### Tests (write these BEFORE the UI)

- `processBar` fills a market order at next-bar open
- A buy limit below current price waits, then fills when price drops
- TP and SL on the same bar → SL wins
- A long position with `high >= TP` closes at TP, `realizedPnl > 0`
- Commission is deducted exactly once on close
- Liquidation triggers when equity goes negative
- Sell short followed by buy back computes correct P&L

---

## 7. Data Pipeline

### Bundled sample data

Ship the app with **5 pre-loaded assets** so it works immediately with zero setup:

| Symbol | Class | Source | Period |
|---|---|---|---|
| EURUSD | forex | Dukascopy (free) | 30 days of 1m |
| GBPUSD | forex | Dukascopy (free) | 30 days of 1m |
| USDJPY | forex | Dukascopy (free) | 30 days of 1m |
| NQ1! | futures | Yahoo Finance | 30 days of 1m |
| ES1! | futures | Yahoo Finance | 30 days of 1m |

Format: gzipped JSON arrays of `Bar` objects in `public/data/{SYMBOL}_1m.json.gz`. A `manifest.json` lists what's available:

```json
{
  "version": 1,
  "assets": [
    {
      "symbol": "EURUSD",
      "class": "forex",
      "timeframes": ["1m"],
      "startTime": 1735689600,
      "endTime": 1738281600,
      "barCount": 43200,
      "fileSize": 2400000
    }
  ]
}
```

The script `scripts/fetch-sample-data.ts` builds these files. Run it once with `pnpm fetch-data` after install.

### Data sources (Phase 3 build)

**Default — synthetic mode.** `pnpm fetch-data` runs offline. A deterministic GBM-style random walk seeded from a checked-in constant produces byte-identical output on every machine. Volatility per instrument is calibrated to plausible historical bands. Session calendars are honored:
- Forex: Sun 22:00 UTC → Fri 22:00 UTC, no Saturday bars. ~31,680 1m bars per instrument over 30 days.
- Futures (CME equity index): Sun 22:00 UTC → Fri 21:00 UTC with a daily 21:00–22:00 UTC maintenance break. ~28,500 1m bars per instrument over 30 days.

**Opt-in — real mode.** `pnpm fetch-data --real` attempts:
- Forex via `dukascopy-node` (handles `.bi5`/LZMA + UTC conversion).
- Futures via `yahoo-finance2` (handles Yahoo's 7-day intraday limit by chunking).

If a real fetch fails for any instrument, that instrument falls back to synthetic and `manifest.json` records the actual source per dataset (`"source": "synthetic" | "dukascopy" | "yahoo"`). Real fetches never block the install or the dev server.

Yahoo's 1m intraday coverage is inconsistent at the 30-day edge; futures instruments may fall back to synthetic in `--real` mode. Run with `--real-window=25` to force a tighter window if needed.

**Note on `--real` mode windowing:** the fetch window is rolling — each run pulls the most recent 30 days from each source, so the date range shifts with each invocation. Synthetic mode uses a fixed seed and produces a stable date range across runs. This asymmetry is by design: synthetic is for reproducibility (tests, demos); real is for current market conditions.

### Aggregation
The engine stores **1-minute bars** as the source of truth. Higher timeframes (5m, 15m, 1h, 4h, 1d) are **computed on-the-fly** by `aggregateBars(bars: Bar[], timeframeMinutes: number): Bar[]`. Pure function, fully tested.

### User-imported data (v1.1, scaffold but don't fully build)
- A `Settings → Import Data` page that accepts CSV uploads matching Dukascopy's format
- Parses, validates, persists to IndexedDB via `BarRepository.bulkInsert()`

---

## 7.5. Datafeed Contract (UDF-shaped)

> **This is the most important architectural choice in the project.** The `DataProvider` interface is shaped after TradingView's UDF (Universal Datafeed) protocol. This means the same data layer works with Lightweight Charts today AND TradingView Trading Platform tomorrow with zero changes.

### Why this matters

TradingView's three charting libraries all consume the same datafeed contract (UDF). Lightweight Charts doesn't formally require it, but mimicking it costs nothing and makes the future swap mechanical.

### `DataProvider` interface

```typescript
// lib/data/DataProvider.ts
export interface DataProvider {
  /**
   * Called once on init. Returns supported configuration.
   * Maps to UDF onReady() callback.
   */
  onReady(): Promise<DatafeedConfiguration>;

  /**
   * Search instruments by user input.
   * Maps to UDF searchSymbols().
   */
  searchSymbols(
    userInput: string,
    exchange: string,
    symbolType: string
  ): Promise<SearchSymbolResult[]>;

  /**
   * Resolve a single symbol to its full info.
   * Maps to UDF resolveSymbol().
   */
  resolveSymbol(symbolName: string): Promise<LibrarySymbolInfo>;

  /**
   * Fetch historical bars for a symbol/resolution/range.
   * Maps to UDF getBars().
   */
  getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,   // '1', '5', '15', '60', '240', '1D'
    periodParams: { from: number; to: number; countBack: number; firstDataRequest: boolean }
  ): Promise<{ bars: Bar[]; meta: { noData: boolean; nextTime?: number } }>;

  /**
   * Subscribe to real-time bar updates.
   * In replay mode, this is driven by the ReplayEngine clock, not network.
   * Maps to UDF subscribeBars().
   */
  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: (bar: Bar) => void,
    listenerGuid: string
  ): void;

  /**
   * Unsubscribe.
   * Maps to UDF unsubscribeBars().
   */
  unsubscribeBars(listenerGuid: string): void;
}

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
  type: string;                  // 'forex', 'futures'
  session: string;               // '24x7' for forex, '0930-1600' for stocks
  timezone: string;
  exchange: string;
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  supported_resolutions: ResolutionString[];
  data_status: 'streaming' | 'endofday' | 'pulsed' | 'delayed_streaming';
}

export type ResolutionString = '1' | '5' | '15' | '60' | '240' | '1D' | string;

export interface SearchSymbolResult {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: string;
}
```

### Implementations

```typescript
// lib/data/BundledDataProvider.ts — v1, reads /public/data/*.json.gz
export class BundledDataProvider implements DataProvider { ... }

// lib/data/ReplayDataProvider.ts — wraps any DataProvider with replay-aware subscribeBars
// (subscribeBars receives ticks from ReplayEngine, not network)
export class ReplayDataProvider implements DataProvider { ... }
```

### Why Lightweight Charts uses this too

Lightweight Charts has a simpler API (`series.update(bar)`), but we wrap it. The chart provider calls `dataProvider.getBars()` to seed the chart, then `dataProvider.subscribeBars()` to receive replay ticks. When swapping to Trading Platform later, the same `DataProvider` plugs into TradingView's expected format directly.

**Reference:** Study TradingView's official datafeed implementation patterns at https://github.com/tradingview/charting-library-tutorial before writing this layer.

---

## 8. UI Architecture & Pages

### Layout
The root layout has a collapsible **left sidebar**, main content area, and a **right context sidebar** that's only present on the trade view (session info, exit, time remaining).

### `/` — Dashboard (the "Dash" view)

Mimics FXReplay's dashboard structure:

1. **Hero strip**: User avatar, "Trader Kind" badge (`Day Trading`, `Swing`, `Scalping` — auto-classified from session history), Battles count, Win Streak with flame icon.
2. **Stats grid (4 cards)**:
   - Win rate (e.g. `48.5%`)
   - Max P&L (e.g. `+10.05%`)
   - Time played (e.g. `15h 28min`)
   - Trades taken (e.g. `102`)
3. **Recent Sessions table**: name, instrument, P&L, status, "Resume" or "View" button.
4. **Active Battles**: cards showing in-progress battles with progress bars.
5. **CTA**: "Start New Session" → opens session creation modal.

### `/trade/[sessionId]` — Trader view

The active replay screen. Layout closely mirrors FXReplay's match page:

```
┌────────────────────────────────────────────────────────────────┐
│ TopBar: [← Back] [Logo] [Place Order ▾] [Menu ▾]               │
├──────────────┬─────────────────────────────────┬───────────────┤
│  LeftSidebar │                                 │ RightSidebar  │
│              │      CHART (Lightweight)        │ Session info  │
│  Nav links   │                                 │ Time elapsed  │
│              │                                 │ Balance       │
│              │                                 │ Equity        │
│              │                                 │ Margin used   │
│              ├─────────────────────────────────┤ [Exit Session]│
│              │ Quick Buy/Sell + Lot size       │               │
│              │ [Buy 73px] [Sell 73px] [Rocket] │               │
│              ├─────────────────────────────────┤               │
│              │ Tabs: Open | Closed             │               │
│              │ Position table                  │               │
│              ├─────────────────────────────────┤               │
│              │ ReplayControls (bottom bar)     │               │
│              │ ⏮  ⏯  ⏭  | 1× 2× 4× 8× 16× | scrubber          │
└──────────────┴─────────────────────────────────┴───────────────┘
```

#### Chart panel
- Lightweight Charts canvas, full width of center column
- Dark theme (background `#000000`, candles green up `#26A69A`, red down `#EF5350`)
- Crosshair shows OHLC + time of hovered bar
- Position lines as horizontal `priceLine`s: entry (blue), TP (green), SL (red)
- Pending order lines as dashed lines

#### Quick Buy/Sell panel
Below the chart, exactly mirrors FXReplay's:
- Lot size numeric input (default 1.0 for forex, 1 contract for futures)
- Big green **Buy** button (`!w-[73px]`, rounded-full)
- Big red **Sell** button (same dimensions)
- "Rocket" icon button = one-click market order with default SL/TP (configurable preset)
- Alert icon = warning state when no SL is set

#### Open / Closed positions tabs
TanStack Table with columns: `Asset | Side | Size | TP | SL | Unrealized | Realized | Commission`. Rows update in real-time as bars advance.

#### Replay controls (bottom)
- ⏮ Step back 1 bar (keyboard `←`)
- ⏯ Play/Pause (keyboard `Space`)
- ⏭ Step forward 1 bar (keyboard `→`)
- Speed selector: `1× 2× 4× 8× 16×` (keyboard `1`-`5`)
- Timeline scrubber (drag to seek)
- "Time remaining" indicator

#### Right sidebar
- Session name (e.g. "Weekends backtesting")
- Time remaining clock
- Current balance / equity / margin used / free margin
- Exit Session button (red icon, with confirm dialog)

### `/battles` — Battles lobby
- Grid of `BattleCard`s: name, instrument, duration, starting balance, leaderboard preview, "Enter Battle" button
- Filter tabs: `Active | Completed | All`
- "Create Battle" button opens a modal

### `/battles/[battleId]` — Single battle view
- Battle rules + leaderboard (`BattleAttempt[]` sorted by `pnlPct`)
- "New Attempt" button → routes to `/trade/{newSessionId}` with battle-rule guardrails enforced

### `/journal` — Trade analytics
- Date range picker
- Filter by instrument, side, tag
- Equity curve line chart
- Win/loss pie chart
- Distribution histogram (P&L bucketed)
- Trade list with sortable columns + click-through to trade detail (with chart screenshot, notes editor)

---

## 9. State Management

Four Zustand stores. Use **slices** pattern, not one mega-store.

### `replayStore`
```typescript
{
  engine: ReplayEngine | null;
  currentBarTime: number;
  currentBarIndex: number;
  isPlaying: boolean;
  speed: 1 | 2 | 4 | 8 | 16;
  totalBars: number;

  initEngine: (bars: Bar[], startIndex: number) => void;
  play: () => void;
  pause: () => void;
  step: (dir: 'forward' | 'back') => void;
  setSpeed: (s: number) => void;
  seek: (time: number) => void;
}
```

### `sessionStore`
```typescript
{
  activeSession: Session | null;
  balance: number;
  equity: number;
  marginUsed: number;

  startSession: (params) => Promise<Session>;
  endSession: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
}
```

### `orderStore`
```typescript
{
  pendingOrders: Order[];
  openPositions: Position[];
  closedTrades: Trade[];

  submitOrder: (order: Omit<Order, 'id' | 'status' | 'createdAt'>) => Promise<void>;
  cancelOrder: (id: string) => Promise<void>;
  modifyPosition: (id: string, changes: { tp?: number; sl?: number }) => Promise<void>;
  closePosition: (id: string) => Promise<void>;
}
```

### `settingsStore` (persisted to localStorage)
```typescript
{
  theme: 'dark' | 'light';
  defaultLotSize: number;
  defaultStopLossPips: number;
  defaultTakeProfitPips: number;
  oneClickTradingEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
}
```

### Wiring the engine to the stores
In `app/providers.tsx`, on mount, subscribe `replayStore.engine` to forward `bar` events into `orderStore` so each new bar triggers `MatchingEngine.processBar()`. Result: every bar advance is one transaction that updates pending orders → open positions → closed trades → account balance.

---

## 10. Visual Design

The visual design will be created using a Claude-generated design spec. **See §13 for the prompt** to feed into Claude (chat) to generate the visual design, then pass that output to Claude Code as `DESIGN_SYSTEM.md`.

For now, defaults to wire up:

- **Theme**: dark mode default
- **Primary blue**: `#0260FD` (FXReplay's accent)
- **Success green**: `#26A69A`
- **Danger red**: `#EF5350` (positions) / `#ED6A5A` (exit, fire icon gradient)
- **Background**: `#000000` (chart) / `#0A0A0F` (panels)
- **Border**: `#1F2025`
- **Text primary**: `#FFFFFF`
- **Text muted**: `#8A8C91`

Use Tailwind CSS variables in `globals.css` so design tokens are swappable later.

Icons: Lucide for general icons. For trading-specific icons (sword for battles, fire for streak, win-rate, max-pl, time-played, trades), create custom SVGs in `public/icons/` matching FXReplay's `pi-*` icon style: simple, single-color, minimal line work.

---

## 11. Keyboard Shortcuts

Bind in `useKeyboardShortcuts.ts`, only active on `/trade/*` routes:

| Key | Action |
|---|---|
| `Space` | Play/Pause |
| `←` | Step back 1 bar |
| `→` | Step forward 1 bar |
| `1`–`5` | Set speed 1× / 2× / 4× / 8× / 16× |
| `B` | Open Buy dialog |
| `S` | Open Sell dialog |
| `M` | Quick market buy (one-click trading must be enabled) |
| `Shift+M` | Quick market sell |
| `Esc` | Close dialogs |
| `Ctrl+Z` | Undo last order (only if not yet filled) |

---

## 12. Implementation Plan (build order)

Build in this exact order. Each phase has an explicit completion gate. **Stop after each phase and let the user verify before continuing.**

### Phase 1: Foundation (Day 1)
1. `npx create-next-app@latest fxtrader --typescript --tailwind --app --src-dir`
2. Install all dependencies from §2.
3. Init shadcn/ui: `npx shadcn-ui@latest init`. Add components: button, dialog, input, select, table, tabs, card, badge, tooltip, dropdown-menu, sheet.
4. Set up Dexie schema in `lib/repository/db.ts`.
5. Create all `types/*.ts` files.
6. Create the 4 Zustand stores (empty actions, just shape).
7. **Gate**: `pnpm dev` starts cleanly. `pnpm typecheck` passes. `pnpm lint` passes.

### Phase 2: Engine + tests (Day 2)
1. Implement `MatchingEngine.processBar()` with all fill rules from §6.
2. Write Vitest tests for every rule. **All must pass before continuing.**
3. Implement `ReplayEngine` clock with subscription model.
4. Test the engine with a small fixture of 100 bars.
5. **Gate**: `pnpm test` shows all engine tests passing. No UI yet.

### Phase 3: Data layer (Day 3)
1. **Read `tradingview/charting-library-tutorial` first** — understand UDF datafeed patterns.
2. Define `DataProvider` interface (§7.5).
3. Write `scripts/fetch-sample-data.ts`: pulls 30 days of 1m EURUSD/GBPUSD/USDJPY from **Dukascopy**, NQ1!/ES1! from **Yahoo Finance**, normalizes, gzips, writes to `public/data/`.
4. Implement `BundledDataProvider` against the interface.
5. Implement `aggregateBars()` with tests (1m → 5m, 1m → 1h, etc.).
6. Wire data → replayStore.
7. **Gate**: A test session loads bars, the replay engine ticks through them, console shows bar events. No UI yet.

### Phase 4: Chart (Day 4)
1. **Read `tradingview/charting-library-examples/nextjs/` for component structure patterns.**
2. Install `lightweight-charts` v4.
3. Define `ChartProvider.types.ts` (the swap-ready interface).
4. Build `LightweightChartProvider` implementing it.
5. Build `ChartContainer` that consumes the provider via context.
6. Render bars from `replayStore.engine.getVisibleBars()`.
7. Verify smooth replay at 1× through 16×.
8. Add position/SL/TP price lines.
9. **Gate**: Charts render, replay controls feed bars to chart in real-time.

### Phase 5: Trade UI (Day 5)
1. `QuickBuySellPanel` with lot input + buy/sell buttons.
2. `PlaceOrderDialog` with full order entry (React Hook Form + Zod).
3. `OpenPositionsTable` + `ClosedPositionsTable` (TanStack Table).
4. `ReplayControls` bar with all keyboard shortcuts.
5. Right sidebar with balance/equity/margin.
6. **Gate**: A user can start a session, place a buy with SL/TP, watch it fill, see it in the open positions table, watch it close at TP.

### Phase 6: Dashboard (Day 6)
1. `/` route with stats grid, recent sessions, active battles.
2. `analytics/stats.ts` — pure functions for win rate, max P&L, time played, expectancy, max drawdown.
3. `trader-kind.ts` — heuristic classifier (avg holding time < 1h → Scalper, < 1 day → Day Trader, else Swing).
4. Session creation modal.
5. **Gate**: Dashboard shows real numbers from sessions in IndexedDB.

### Phase 7: Battles + Journal (Day 7)
1. Battles lobby + create/enter flow.
2. Battle rule enforcement during sessions.
3. Journal page with equity curve + filters.
4. Trade detail drawer with notes.
5. **Gate**: Create battle → enter → trade → complete → see attempt on leaderboard. Journal shows equity curve from session history.

### Phase 8: Polish
1. Empty states for every page.
2. Loading skeletons.
3. Error boundaries.
4. README.md (see §14).
5. Screenshot the trade view for the eventual landing page.

---

## 13. Visual Design Prompt (paste into Claude chat, separately from Claude Code)

> **Use this prompt in a fresh Claude chat to generate the design system. Save the output as `DESIGN_SYSTEM.md` in the project root for Claude Code to consume.**

```
I'm building a trading backtesting and replay simulator called FXTrader, inspired by FXReplay.

Generate a complete visual design system for it. The product is a desktop-first web app where 
users replay historical market data candle-by-candle and place simulated trades to practice. 
It's serious, professional, and slightly playful (it has a "Battles" gamification mode).

The audience is retail traders aged 20–45 who care about looking like a real trading platform.

Output a `DESIGN_SYSTEM.md` document with these sections:

1. Brand identity — name, tagline, personality (3 adjectives), inspiration references
2. Color palette — primary, secondary, success, danger, warning, neutrals (5 shades), 
   chart colors (bullish, bearish, volume, MA1, MA2). Specify both dark mode (default) 
   and light mode hex values, plus Tailwind CSS variable names.
3. Typography — font families (one display, one body, one mono for prices), 
   weights, type scale (xs to 4xl), letter spacing, line heights
4. Spacing — 4px-base scale
5. Border radius — full scale (sm, md, lg, full for pills/buttons)
6. Shadows — none, sm, md, lg + a special "glow" for primary CTAs
7. Component styling guidelines for:
   - Buttons (primary, secondary, success/buy, danger/sell, ghost, icon-only)
   - Cards (default, elevated, stat card with icon + label + value)
   - Tables (header, hover row, selected row, empty state)
   - Inputs (default, focused, error, with icon, numeric stepper)
   - Tabs
   - Modals/dialogs
   - Tooltips
   - Badges (Pro, Day Trading, Win Streak)
   - Toasts (success, error, info)
8. Iconography — line vs filled, stroke width, sizing
9. Motion — transition durations, easing curves, what should and shouldn't animate
10. Trading-specific visual rules — how positions render on chart (entry line, SL, TP), 
    how P&L is colored (green for profit, red for loss, never reverse), 
    how live-updating numbers should pulse subtly on change
11. A sample dashboard layout in ASCII so I can see the spatial relationships
12. Tailwind config snippet (`theme.extend.colors`, `theme.extend.fontFamily`) ready to paste

Constraints:
- Dark mode is the default and must look "expensive" and serious, not flat black
- Buy/Sell colors must remain instantly readable (don't get clever with non-standard hues)
- Layout is information-dense; don't over-pad
- The aesthetic should feel like a high-end pro tool (think Linear, Bloomberg Terminal, FXReplay), 
  not a consumer fintech app

Avoid:
- Purple gradients (overused in fintech)
- Glassmorphism overkill
- Cute illustrations
- Emoji as UI elements

Deliver a single self-contained Markdown document.
```

---

## 14. README requirements

Claude Code should generate a `README.md` covering:

1. What FXTrader is (1 paragraph)
2. Quick start: `pnpm install && pnpm fetch-data && pnpm dev` (synthetic, fast, offline). Note that `pnpm fetch-data --real` attempts real Dukascopy + Yahoo fetches with synthetic fallback per-instrument.
3. How to load more historical data (script + manual CSV import)
4. How the replay engine works (link to §5)
5. **The TradingView upgrade path** — how to swap Lightweight Charts for the Trading Platform library when ready (see §18 of this spec; concrete file-by-file steps)
6. Keyboard shortcuts cheat sheet
7. Tech stack
8. Project structure
9. Roadmap (multi-user, cloud sync, indicators, custom strategies, public launch)

---

## 15. Definition of Done (v1)

- [ ] User runs `pnpm install && pnpm fetch-data && pnpm dev` and immediately starts a replay session on any of 5 bundled instruments.
- [ ] Replay plays smoothly at 1×–16× without dropping bars.
- [ ] Place market/limit/stop orders with SL/TP, see them fill correctly.
- [ ] Position table updates live every bar.
- [ ] Sessions persist across reloads (IndexedDB).
- [ ] Dashboard shows real, computed stats from session history.
- [ ] At least one Battle can be created, entered, completed, ranks on a leaderboard.
- [ ] Journal shows equity curve and trade list.
- [ ] All MatchingEngine tests pass.
- [ ] `pnpm fetch-data` succeeds offline (synthetic mode) and produces deterministic, byte-identical output across machines.
- [ ] `DataProvider` matches UDF shape (verified against `charting-library-tutorial`).
- [ ] Type-check + lint clean.
- [ ] README is complete enough that a developer can clone and run in < 5 min.

---

## 16. v1 anti-goals (resolved in v2 — see §16.1)

- ❌ Do not build a backend, server, or database server. Browser-only.
- ❌ Do not connect to live broker APIs.
- ❌ Do not implement strategy/algo backtesting (no Pine Script equivalent).
- ❌ Do not add user accounts, auth, or social features.
- ❌ Do not commit any TradingView Advanced Charts or Trading Platform library files (license forbids redistribution).
- ❌ Do not use `any` in TypeScript. If you can't type something, ask.
- ❌ Do not use `dangerouslySetInnerHTML`.
- ❌ Do not add analytics, telemetry, or external tracking.
- ❌ Do not deviate from the UDF-shaped `DataProvider` interface.

---

## 16.1. v2 scope expansion *(May 2026 — after v1 validation)*

v1 was scoped tight: single-user, browser-only, no backend. Those anti-goals
were the right call for v1 — they kept the surface small enough to ship a
working backtester in 8 phases without scope creep, and they're recorded
above as a record of original intent. Don't read §16 as "wrong"; read it as
"what we deliberately deferred to validate the core engine first."

v2 expands the scope after v1 validation: the engine + analytics + journal
proved out, and the natural next step is async multi-user battles where
friends can compete on the same historical replay window without playing
synchronously.

### What v2 changes vs §16

- **"Do not build a backend"** → v2 introduces a Convex backend for
  multiplayer battle storage. Single-player session/trade/battle rows
  continue to live in IndexedDB; only the multiplayer paths are server-backed.
- **"Do not add user accounts, auth, or social features"** → v2 adds
  email/password signup via `@convex-dev/auth`. As of v2.1.5 the entire
  authed app (`/dashboard`, `/battles`, `/journal`, `/trade/*`) is gated
  behind sign-in. The only public surface is `/`, `/signin`, `/signup`.

### What v2 explicitly does NOT change

The other §16 anti-goals stand:

- **No live broker APIs** — still a simulator.
- **No strategy/algo backtesting** — still discretionary replay only.
- **No TradingView Trading Platform redistribution** — license still applies.
- **No `any` in TypeScript, no `dangerouslySetInnerHTML`, no analytics.**

### URL structure (post-v2.1.5)

| Path | Auth | Notes |
|---|---|---|
| `/` | public | Landing page (`Hero`, `ProductShowcase`, `LandingNav`) |
| `/signin`, `/signup` | public | Email/password forms |
| `/dashboard` | gated | Formerly `/`. The authed app's home. |
| `/battles`, `/journal`, `/trade/[id]` | gated | Existing v1 routes |
| `/settings` | gated | Reserved; not built yet, but in the auth allowlist |

Anonymous hits to gated routes redirect 307 → `/signin?next=<path>`. The
`next` param is validated against an allowlist of known route prefixes
(`/dashboard`, `/battles`, `/journal`, `/trade`, `/settings`) and rejected
on protocol-relative URLs, backslashes, and prefix-substring tricks
(`/dashboardadmin` → falls back to `/dashboard`). See
`src/lib/auth/nextParam.ts` for the validator + `nextParam.test.ts` for
the threat-model coverage.

### v2 phase plan

Phase numbering follows v1's convention but uses `v2.N` to distinguish.

- **v2.1** ✅ shipped May 2026 — Backend foundation. Convex deployment,
  schema for `profiles` / `battles` / `battleAttempts`, email/password
  auth via `@convex-dev/auth`, signup + signin pages, profile menu in
  page headers. Four post-ship fixups (race condition in client signup,
  auth.config.ts env var flip-flop, hard-reload after signin) — see git
  history `c6e4299` → `b18513d`.
- **v2.1.5** ✅ shipped May 2026 — Public landing + mandatory auth gate
  + URL split. Moved dashboard to `/dashboard`, made `/` a marketing
  landing (Hero + ProductShowcase + LandingNav), gated everything else.
  Validated `next` redirect param via `lib/auth/nextParam.ts` against
  open-redirect attacks. v1 IndexedDB data is "orphaned" on first
  signup (option (a)) — anyone who used v1 single-player starts the
  authed app empty; old data exists in IndexedDB but is unreachable
  from the authed UI.
- **v2.1.6** ✅ shipped May 2026 — Case-insensitive email + whitespace
  normalization + UX-friendly auth errors. Server-side normalization
  in `Password.profile()`, client-side in `lib/auth/emailNormalize.ts`,
  `noValidate` on auth forms (browser native validator was blocking
  before normalize ran), pre-check `users.emailExists` query on signup
  to reject duplicates explicitly (instead of @convex-dev/auth's silent
  "same-email-same-password = signin" default). 47 unit tests added.
- **v2.2** ✅ shipped May 2026 — Server-backed battles + FXReplay-style
  creation form + form-only multi-asset (`ebab8dd`). CreateBattleDialog
  with FXReplay-parity fields (Public Match toggle, Duration radios in
  minutes, Profit Target, Account Balance dropdown, Max Participants
  cap, chip-style multi-asset selector capped at 1-5). `convex/battles.ts`
  with `createBattle` / `submitAttempt` / `listMyBattles` /
  `listPublicBattles` / `getBattleByInviteCode` / `listAttempts`
  mutations + queries. Snapshot leaderboard. Invite-link landing page
  at `/battles/join/[inviteCode]`. Schema accepts `instruments: string[]`
  (1-5) but trade view plays `instruments[0]` only — full per-instrument
  switching is v2.2.5. Many-attempts-per-user model (resumable
  single-attempt is v2.3).
- **v2.2.5** ✅ shipped May 2026 — Multi-instrument engine + multi-pane
  workspace + on-chart trading interactions. The originally-planned α/β
  split (foundation first, then configurability) collapsed into one
  bundled release because user-driven iteration kept pulling β items
  forward during α implementation. Shipped scope:
    - **Engine**: `MasterClock` coordinator owning N `ReplayEngine`s under
      one shared market clock; `ReplayEngine.advanceTo(time)` external
      drive + `seekToOrBefore` + `dispose`; `BarAggregator` with
      `(timeframe, lastBarTime, sourceBarsRef)` cache key + live-candle
      convention.
    - **Stores**: `replayStore.engines: Map<symbol, ReplayEngine>` +
      `masterClock` + `setActiveInstrument` + `getEngine` + lifecycle
      dispose; `loadInstrumentsMulti` mid-dataset clamp; `orderStore`
      routes through per-instrument engines and filters re-marks to the
      firing instrument (multi-instrument P&L correctness);
      `forceCloseAllPositions("liquidated")`; `sessionStore.applyBarSettlement`
      aggregates margin across instruments; `battleSnapshot` on Session
      so server-battle rules survive reload.
    - **Layout**: `layoutStore` with full configurability — `LayoutSelector`
      (1/2v/2h/4q/6-pane), per-pane instrument dropdown, per-pane timeframe
      selector (auto-fade on 2s idle), drag-resize splitter overlays via
      gridSplits, Today jump button (visibility tied to `paneIsAtLatest`);
      `ChartGrid` + `ChartPane` with click-to-focus and U3 (focus change
      closes any open Place Order dialog).
    - **U5 persistence**: 2s periodic save of openPositions, pendingOrders,
      layoutState, currentBarTime, balance to Dexie; boot restore seeks
      master clock to currentBarTime and rehydrates positions/orders.
    - **Trading UX**: QuickBuySellPanel unit toggle (pips/USD/%) with
      commission-aware delta conversion + inverse for unit cycling;
      pre-trade SL/TP/trigger preview lines anchored to staging trigger;
      draggable preview chip via `PreviewTriggerDrag`; on-chart
      `PositionDragOverlay` chips for position entry/TP/SL and pending-
      order trigger/TP/SL with X-close on entry and live limit/stop;
      live-trigger drag past SL/TP grays the offending chip and drops
      (or replaces, for require-SL battles) on release; immediate-trigger
      validation; PlaceOrderDialog pips↔price dual inputs.
    - **Liquidation**: idempotent DQ handler (Set guard against multi-
      engine fire) → force-close → pause clock → endSession +
      submitToServer → SessionEndedOverlay with full battle summary +
      back-to-battle href that respects `${battleSource}-${battleId}`
      prefix; submitOrder blocked when session.status === "ended".
- **v2.2.6a** ✅ shipped May 2026 — Per-pane position-count badges (U2).
  Small numeric pill in each pane's top-left chrome, adjacent to the
  instrument selector, showing the count of open positions for that
  pane's instrument. Hidden at zero with opacity transition for
  0↔1+ fade. Active vs. inactive pane styling differentiates so the
  focused pane is still visually distinct. Multi-pane same-instrument
  duplicates show the same count in each (correct semantic — same
  underlying positions, two views).
- **v2.2.6b** ✅ shipped May 2026 — Per-pane market-hours indicator
  dot (D4 reframed). Originally scoped as a translucent chart-area
  curtain overlay; user feedback during implementation pivoted to a
  small green/red status dot inside the `PaneInstrumentSelector`
  chip (replacing the prior blue active-pane dot, which was
  redundant with the chip's border-color signal). Master-clock-driven:
  the dot flips the moment `replayStore.currentBarTime` crosses the
  next-open / next-close boundary, regardless of whether a bar has
  arrived from the dataset. Visual: 8px core dot with a softer
  same-hue halo ring + outer glow + 300ms color transition. Native
  `title` tooltip shows "Market open" or "Market closed — opens
  Sun 22:00 UTC". Hidden entirely for instruments without a
  `sessionHours` preset (defensive: better to show nothing than a
  wrong signal). 16 unit tests cover boundary detection (forex
  Sun 22:00 UTC open, Fri 22:00 UTC close; CME Sun 23:00 UTC open;
  unknown-instrument fallback). DST not modeled — overlay drifts
  ±1hr around DST changeovers vs. real exchange clock; acceptable
  trade-off for a replay simulator. CME 22:00–23:00 UTC weekday
  maintenance break also not modeled to avoid daily flicker.
- **v2.2.6c** ⏳ after 2.2.6b — Per-pane scroll-position persistence.
  Extend `layoutState` with per-pane `visibleRangeStart`/`visibleRangeEnd`;
  capture from ChartContainer's existing visible-range subscription;
  restore on boot via `setVisibleRange`. Defensive: if persisted range
  falls outside the loaded dataset, fall back to fit-content rather
  than crashing the chart restore.
- **v2.3** ⏳ after v2.2.5 — Battle context UI + resumable attempts.
  Meaty phase, possibly larger than v2.2.5. Includes:
    - Countdown timer in the trade view ("Time Remaining 00:54:51")
    - "Ready? / Battle starts now!" intro transition
      (see `references/fxreplay-battle-ready.png` for visual)
    - Live leaderboard panel (realtime updates as attempts complete)
    - Participants list (5/10) with online/offline status
    - "Go to" navigation between battle elements
    - One attempt per (user, multiplayer battle)
    - Server-side resumable in-flight state — the "Exit session" button
      must NOT finalize the attempt; only liquidation, profit-target
      hit, or an explicit "Submit & Exit" action finalize. Plain Exit
      returns to dashboard with attempt resumable from the same
      bar/balance/positions/orders state.
    - Watch-on-after-liquidation mode (read-only chart/positions view)
    - Rules display inside the trade panel during multiplayer play
  Reference visual: `references/fxreplay-battle-active.png`.
  Sync strategy, leaderboard-refresh cadence, and liquidation criteria
  decisions to be made in the v2.3 plan (multiple D-decisions expected).
- **v2.4** ⏳ after v2.3 — Spectator mode. While a multiplayer battle
  is active, any participant or invited spectator can open a "watch"
  view of another player's chart, positions, and equity in
  near-real-time. Read-only; no interaction. Architecturally similar
  size to v2.2.5 (5-8 D-decisions: sync strategy, privacy/opt-in,
  replay-log vs live-state, spectator UI layout, etc.). NOT polish —
  this is a real architectural phase. Decision driven by "watching
  each other trade is the point of multiplayer" framing.
- **v2.5** ⏳ after v2.4 — TBD polish based on real friend-group usage
  of v2.2 → v2.4. Likely includes revisions to v2.2.5/v2.3/v2.4 choices
  once real usage surfaces friction. Cannot be pre-planned; informed
  by actual use.

Phases v2.1–v2.2.6b are complete. v2.2.6c is shipping next, then
v2.3 / v2.4 / v2.5.

### Decisions baked into v2.0 (and the why)

- **Convex over Supabase** — single vendor, real-time queries are
  first-class, simpler than Postgres + manual subscription channels.
- **Convex built-in auth, not Clerk** — one vendor not two. Sufficient for
  a friends-only deployment. Swap to Clerk later if/when org/RBAC features
  are needed.
- **Email/password only, no OAuth, no password reset** — minimum viable
  for friends-only. Recovery is Discord ("text me, I'll reset you").
  See BACKLOG for the followup tasks when v2.x opens to public.
- **Mandatory auth gate, no anonymous coexistence** (v2.1.5 reversal of
  earlier decision) — simpler architecture, cleaner mental model. v1 IndexedDB
  data is orphaned per option (a); friends-only scale where nobody has
  meaningful v1 data made this an acceptable cut.
- **Snapshot leaderboard, not mark-to-market** — leaderboards update on
  trade close (realized P&L only). Comparing intra-bar mtm of users at
  different replay positions is misleading. Normalized %-of-bar leaderboard
  is a v2.x option only if asymmetry becomes a usability problem.
- **No replay-log verification** — server trusts the client's reported
  attempt result. Friends-only deployment, anti-cheat is overkill at this
  scale. **Revisit before opening to public lobbies.** This is the largest
  scope cut from the v2 plan and the one most likely to bite if the
  product opens up.
- **Many attempts per (user, battle); leaderboard shows best, exposes
  attempt count** — same model as v1's local battles. "Alice · best +5.8%
  · 3 attempts" distinguishes one-shot wins from grinding. *Note: v2.3
  changes this to one-attempt-per-user-per-battle with resumable
  in-flight state for MULTIPLAYER battles only. Local single-player
  battles retain the many-attempts model.*
- **Globally unique, case-insensitive display names** — stored as-typed
  for display, `displayNameLower` for the uniqueness check. Renamable
  once per 7 days. Display name is snapshotted on `battleAttempts` and
  `battles.createdBy*` rows so historical leaderboards don't rewrite when
  someone renames.
- **Public + invite-only at battle creation, default invite-only** —
  invite-only by default reduces the chance of a stray public battle on
  first launch.
- **Time-bounded battles, default 7-day expiration** — keeps the active
  set bounded and prevents stale battles cluttering the lobby.

---

## 17. When stuck, ask

If any requirement is unclear, ambiguous, or conflicts with another part of this doc, **stop and ask the user before guessing**. Especially around:

- Matching engine edge cases (gaps, after-hours, weekends in forex)
- Margin/liquidation rules
- Exact pip/tick values for any new instrument
- Visual decisions not covered in `DESIGN_SYSTEM.md`

Ship small, ship correct, ship tested.

---

## 18. Path to TradingView Trading Platform (future, optional)

The architecture is designed so this swap is a **contained, mechanical change** when (or if) the user decides to launch publicly. Don't execute any of this during v1 — it's documented here for future reference.

### Why upgrade later

The Trading Platform library is the same one Interactive Brokers and Refinitiv use. It includes:
- 100+ built-in indicators (RSI, MACD, Bollinger Bands, etc.) — replaces hand-rolled indicator work
- 80+ drawing tools (trendlines, Fib, etc.)
- **Trading directly from the chart** — drag SL/TP lines, click to place orders on price
- Multiple chart layouts (1, 2, 4 panel views)
- Watchlists, multiple timeframes
- The TradingView aesthetic users already know from FXReplay

This eliminates significant amounts of custom UI work and dramatically polishes the product.

### Eligibility

The Trading Platform library is **NOT available for personal/hobby use**. From TradingView's FAQ:

> "At this time, we don't provide the Advanced Charts and the Trading Platform libraries for personal use, hobbies, studies, or testing. These licenses are only available to companies for use in public web projects and/or applications."

### Pre-application checklist (when ready to launch publicly)

| Step | Time | Cost |
|---|---|---|
| Buy a domain (e.g. `fxtrader.app`) | 10 min | ~$15/yr |
| Set up business email via Cloudflare Email Routing → Gmail | 15 min | $0 |
| Build a simple landing page (Next.js + Vercel) with product description, screenshots, beta signup form | 2–4 hrs | $0 |
| Deploy to Vercel with the custom domain | 10 min | $0 |
| Optional: register a sole proprietorship / DBA in your state | varies | $0–$50 |

You do **not** need an LLC, EIN, business bank account, or lawyer.

### Application process

1. Visit https://www.tradingview.com/trading-platform/
2. Click "Get the library"
3. Fill out the application form using:
   - Your business email (`you@fxtrader.app`)
   - The public landing page URL as your "website"
   - Project description: *"Public web application for traders to practice strategies on historical market data via simulated trading. The Trading Platform library will display historical bars fed by a custom UDF datafeed and accept simulated orders via the in-chart trading interface."*
4. Wait 1–7+ business days for approval (sometimes longer)
5. Accept the GitHub invite emailed to you
6. Clone the private repo

### The swap (once approved)

The architecture makes this a contained change:

```
1. Add private repo as a git submodule (or copy library files into public/charting_library/)
2. Add charting_library/ and datafeeds/ to .gitignore (license forbids redistribution)
3. Create src/components/chart/TradingPlatformProvider.tsx implementing ChartProvider.types.ts
4. Adapt the existing DataProvider to TradingView's expected datafeed (mostly pass-through 
   since we're already UDF-shaped)
5. Replace the import in src/components/chart/ChartContainer.tsx:
   - import { LightweightChartProvider } from './LightweightChartProvider';
   + import { TradingPlatformProvider } from './TradingPlatformProvider';
6. Remove now-redundant components:
   - QuickBuySellPanel.tsx (replaced by in-chart trading)
   - Most of overlays/PositionLine.tsx (TV draws position lines natively)
7. Update README.md with note: "After clone, manually drop charting_library/ from your 
   private TV repo into public/ before running pnpm dev"
```

### Reference repos

- https://github.com/tradingview/charting-library-tutorial — datafeed patterns (read this BEFORE the swap)
- https://github.com/tradingview/charting-library-examples — has a `nextjs/` integration to copy from
- https://github.com/tradingview/awesome-tradingview — community resources

### License caveats

- ✅ Free to use, including commercial
- ❌ Cannot redistribute the library files (private repo required)
- ❌ Public GitHub repo containing the library is a violation
- ✅ The compiled application can be deployed publicly

---

## 19. References

Required reading before specific phases:

| Phase | Repo / Doc | Why |
|---|---|---|
| Phase 3 (data layer) | https://github.com/tradingview/charting-library-tutorial | UDF datafeed protocol patterns — our `DataProvider` mirrors this |
| Phase 4 (chart) | https://github.com/tradingview/lightweight-charts | API docs and examples |
| Phase 4 (chart) | https://github.com/tradingview/charting-library-examples/tree/main/nextjs | Next.js integration patterns (transferable to Lightweight Charts) |
| Future swap | https://github.com/tradingview/awesome-tradingview | Community datafeeds and integrations |
| FXReplay reference | Scraped HTML in `../Dash` and `../Trader` | UI inspiration |
| FXReplay battle UI reference | `references/fxreplay-battle-active.png` | Visual baseline for battle context UI (v2.3 scope) |
| FXReplay battle intro | `references/fxreplay-battle-ready.png` | "Ready?" intro transition reference (v2.3 scope) |

---

## End of master spec

Build small, build correct, build tested. Ask before guessing.
