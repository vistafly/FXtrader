/**
 * Phase 6 gate proof: seeds a synthetic Session+Trade history identical to
 * what the dashboard would read from Dexie, then runs the analytics
 * pipeline and prints the derived dashboard values.
 *
 * Confirms the analytics functions work end-to-end on realistic input;
 * pure-Node (no IndexedDB / browser).
 */

import {
  computeOverview,
  computePerSessionPnl,
  computeWinStreak,
  formatDuration,
  formatMoney,
  formatPercent,
} from "../src/lib/analytics/stats";
import { classifyTraderKind } from "../src/lib/analytics/trader-kind";
import type { Session } from "../src/types/session";
import type { Trade } from "../src/types/trade";

const sessions: Session[] = [
  {
    id: "sess-1",
    name: "Practice run",
    instrument: "EURUSD",
    startBarTime: 1_700_000_000,
    currentBarTime: 1_700_005_000,
    startingBalance: 10_000,
    currentBalance: 10_350,
    createdAt: 1_700_000_000,
    lastPlayedAt: 1_700_005_000,
    status: "ended",
    speedSetting: 1,
  },
  {
    id: "sess-2",
    name: "London open",
    instrument: "GBPUSD",
    startBarTime: 1_700_010_000,
    currentBarTime: 1_700_018_000,
    startingBalance: 10_000,
    currentBalance: 9_750,
    createdAt: 1_700_010_000,
    lastPlayedAt: 1_700_018_000,
    status: "ended",
    speedSetting: 1,
  },
  {
    id: "sess-3",
    name: "NQ scalp",
    instrument: "NQ1!",
    startBarTime: 1_700_020_000,
    currentBarTime: 1_700_023_000,
    startingBalance: 10_000,
    currentBalance: 10_420,
    createdAt: 1_700_020_000,
    lastPlayedAt: 1_700_023_000,
    status: "active",
    speedSetting: 4,
  },
];

const trades: Trade[] = [
  // sess-1 — net +$350
  trade("sess-1", "EURUSD", "buy", 1.10, 1.105, 60, +200, 1_700_000_500),
  trade("sess-1", "EURUSD", "buy", 1.103, 1.100, 90, -50, 1_700_001_000),
  trade("sess-1", "EURUSD", "sell", 1.107, 1.103, 120, +200, 1_700_002_000),
  // sess-2 — net -$250
  trade("sess-2", "GBPUSD", "buy", 1.265, 1.262, 180, -150, 1_700_011_000),
  trade("sess-2", "GBPUSD", "sell", 1.263, 1.265, 240, -100, 1_700_013_000),
  // sess-3 — net +$420
  trade("sess-3", "NQ1!", "buy", 18250, 18260, 45, +200, 1_700_020_500),
  trade("sess-3", "NQ1!", "buy", 18255, 18261, 30, +120, 1_700_021_000),
  trade("sess-3", "NQ1!", "sell", 18268, 18263, 30, +100, 1_700_021_500),
];

function trade(
  sessionId: string,
  instrument: string,
  side: "buy" | "sell",
  entry: number,
  exit: number,
  duration: number,
  pnl: number,
  exitTime: number,
): Trade {
  return {
    id: `${sessionId}-${exitTime}`,
    sessionId,
    instrument,
    side,
    size: 1,
    entryPrice: entry,
    entryTime: exitTime - duration,
    exitPrice: exit,
    exitTime,
    pnl,
    pips: 0,
    commission: 7,
    duration,
    closeReason: "manual",
  };
}

console.log("=".repeat(60));
console.log("Phase 6 — sample analytics from seeded Session+Trade history");
console.log("=".repeat(60));
console.log(`Seeded: ${sessions.length} sessions, ${trades.length} closed trades`);
console.log();

const overview = computeOverview(sessions, trades);
const perSession = computePerSessionPnl(sessions, trades);
const traderKind = classifyTraderKind(trades);
const streak = computeWinStreak(trades);

console.log("Trader profile:");
console.log(`  Trader kind   ${traderKind}`);
console.log(`  Win streak    ${streak === 0 ? "—" : streak}`);
console.log();

console.log("Stats grid (4 cards):");
console.log(`  Win rate         ${formatPercent(overview.winRate)}    (${overview.wins} W · ${overview.losses} L)`);
console.log(`  Max session P&L  ${formatMoney(overview.maxPnl, true)}    (${formatPercent(overview.maxPnlPct, 2)})`);
console.log(`  Time played      ${formatDuration(overview.timePlayedSeconds)}`);
console.log(`  Trades taken     ${overview.trades}`);
console.log();

console.log("Secondary metrics:");
console.log(`  Max drawdown     ${formatMoney(overview.maxDrawdown)}`);
console.log(`  Expectancy       ${formatMoney(overview.expectancy, true)} / trade`);
console.log();

console.log("Per-session P&L:");
for (const p of perSession) {
  const s = sessions.find((x) => x.id === p.sessionId)!;
  console.log(
    `  ${s.name.padEnd(15)}  ${s.instrument.padEnd(8)}  ${formatMoney(p.pnl, true).padStart(10)}  ${formatPercent(p.pnlPct, 2).padStart(8)}`,
  );
}
console.log();

console.log("Empty-case smoke (defensive contract):");
const empty = computeOverview([], []);
console.log(`  Zero data: winRate=${formatPercent(empty.winRate)} expectancy=${formatMoney(empty.expectancy)} maxDD=${formatMoney(empty.maxDrawdown)} time=${formatDuration(empty.timePlayedSeconds)}`);
console.log("=".repeat(60));
