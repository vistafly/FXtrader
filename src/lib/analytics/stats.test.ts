import { describe, expect, it } from "vitest";

import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

import {
  computeMaxDrawdown,
  computeOverview,
  computePerSessionPnl,
  computeWinStreak,
  formatDuration,
  formatMoney,
  formatPercent,
} from "./stats";
import { classifyTraderKind } from "./trader-kind";

const makeSession = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  name: "Test",
  instrument: "EURUSD",
  startBarTime: 1_700_000_000,
  currentBarTime: 1_700_001_000,
  startingBalance: 10_000,
  currentBalance: 10_000,
  createdAt: 1_700_000_000,
  lastPlayedAt: 1_700_001_000,
  status: "active",
  speedSetting: 1,
  ...over,
});

const makeTrade = (over: Partial<Trade> = {}): Trade => ({
  id: "t1",
  sessionId: "s1",
  instrument: "EURUSD",
  side: "buy",
  size: 1,
  entryPrice: 1.10,
  entryTime: 1_700_000_000,
  exitPrice: 1.105,
  exitTime: 1_700_000_300,
  pnl: 50,
  pips: 50,
  commission: 7,
  duration: 300,
  closeReason: "manual",
  ...over,
});

// ---------------------------------------------------------------------------
// Empty-case defensive tests (Phase 6 explicit requirement)
// ---------------------------------------------------------------------------

describe("Phase 6 empty-case defensive contract", () => {
  it("zero sessions → empty overview, no NaN/Infinity", () => {
    const o = computeOverview([], []);
    expect(o.trades).toBe(0);
    expect(o.wins).toBe(0);
    expect(o.losses).toBe(0);
    expect(o.winRate).toBeNull();
    expect(o.expectancy).toBeNull();
    expect(o.maxDrawdown).toBeNull();
    expect(o.maxPnl).toBeNull();
    expect(o.maxPnlPct).toBeNull();
    expect(o.timePlayedSeconds).toBeNull();
  });

  it("sessions exist but zero closed trades → metrics return null, not 0 or NaN", () => {
    const o = computeOverview([makeSession()], []);
    expect(o.trades).toBe(0);
    expect(o.winRate).toBeNull();
    expect(o.expectancy).toBeNull();
    expect(o.maxDrawdown).toBeNull();
    expect(o.timePlayedSeconds).toBeNull();
    // computeMaxDrawdown also explicitly returns null for empty input
    expect(computeMaxDrawdown([])).toBeNull();
    // formatters render null as "—"
    expect(formatPercent(o.winRate)).toBe("—");
    expect(formatMoney(o.expectancy)).toBe("—");
    expect(formatDuration(o.timePlayedSeconds)).toBe("—");
  });

  it("all winners → no division-by-zero, winRate=100%, no broken averages", () => {
    const trades = [
      makeTrade({ id: "t1", pnl: 100 }),
      makeTrade({ id: "t2", pnl: 200 }),
      makeTrade({ id: "t3", pnl: 50 }),
    ];
    const o = computeOverview([makeSession()], trades);
    expect(o.wins).toBe(3);
    expect(o.losses).toBe(0);
    expect(o.winRate).toBe(1);
    expect(o.expectancy).toBeCloseTo((100 + 200 + 50) / 3, 6);
    // No drawdown in a strictly winning sequence — but the contract says
    // we never return NaN. Should be 0 (a real number, the smallest valid
    // drawdown), not null.
    expect(o.maxDrawdown).toBe(0);
    expect(Number.isFinite(o.maxDrawdown ?? NaN)).toBe(true);
  });

  it("all losers → no division-by-zero, winRate=0%, drawdown finite", () => {
    const trades = [
      makeTrade({ id: "t1", pnl: -100 }),
      makeTrade({ id: "t2", pnl: -200 }),
    ];
    const o = computeOverview([makeSession()], trades);
    expect(o.wins).toBe(0);
    expect(o.losses).toBe(2);
    expect(o.winRate).toBe(0);
    expect(o.expectancy).toBeCloseTo(-150, 6);
    expect(o.maxDrawdown).toBe(300); // peak 0, trough -300
  });

  it("session with startingBalance=0 → no division-by-zero in pnlPct", () => {
    const session = makeSession({ startingBalance: 0 });
    const trades = [makeTrade({ pnl: 50 })];
    const per = computePerSessionPnl([session], trades);
    expect(per[0].pnl).toBe(50);
    expect(per[0].pnlPct).toBe(0); // not Infinity
    expect(Number.isFinite(per[0].pnlPct)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Standard cases
// ---------------------------------------------------------------------------

describe("computeOverview — standard cases", () => {
  it("mix of wins and losses computes correct rates", () => {
    const trades = [
      makeTrade({ id: "1", pnl: 100 }),
      makeTrade({ id: "2", pnl: -50 }),
      makeTrade({ id: "3", pnl: 75 }),
      makeTrade({ id: "4", pnl: -25 }),
    ];
    const o = computeOverview([makeSession()], trades);
    expect(o.wins).toBe(2);
    expect(o.losses).toBe(2);
    expect(o.winRate).toBe(0.5);
    expect(o.expectancy).toBeCloseTo(25, 6);
  });

  it("zero-pnl trade counts as neither win nor loss", () => {
    const trades = [
      makeTrade({ id: "1", pnl: 100 }),
      makeTrade({ id: "2", pnl: 0 }),
    ];
    const o = computeOverview([makeSession()], trades);
    expect(o.wins).toBe(1);
    expect(o.losses).toBe(0);
    expect(o.winRate).toBe(1); // 1/(1+0)
  });

  it("orphan trades whose session was deleted are ignored in per-session P&L", () => {
    const trades = [
      makeTrade({ sessionId: "s1", pnl: 100 }),
      makeTrade({ sessionId: "deleted", pnl: 999 }),
    ];
    const per = computePerSessionPnl([makeSession({ id: "s1" })], trades);
    expect(per).toHaveLength(1);
    expect(per[0].pnl).toBe(100);
  });
});

describe("computeMaxDrawdown", () => {
  it("computes peak-to-trough drawdown across the equity curve", () => {
    const trades = [
      makeTrade({ id: "1", pnl: 100, exitTime: 100 }), // equity 100, peak 100
      makeTrade({ id: "2", pnl: 200, exitTime: 200 }), // equity 300, peak 300
      makeTrade({ id: "3", pnl: -150, exitTime: 300 }), // equity 150, dd 150
      makeTrade({ id: "4", pnl: -50, exitTime: 400 }), // equity 100, dd 200
      makeTrade({ id: "5", pnl: 250, exitTime: 500 }), // equity 350, peak 350
    ];
    expect(computeMaxDrawdown(trades)).toBe(200);
  });
});

describe("computeWinStreak", () => {
  it("returns consecutive recent wins, stopping at first loss", () => {
    const trades = [
      makeTrade({ id: "1", pnl: 100, exitTime: 100 }),
      makeTrade({ id: "2", pnl: -50, exitTime: 200 }),
      makeTrade({ id: "3", pnl: 100, exitTime: 300 }),
      makeTrade({ id: "4", pnl: 50, exitTime: 400 }),
      makeTrade({ id: "5", pnl: 25, exitTime: 500 }), // most recent
    ];
    // Most recent 3 are wins; trade 2 (a loss) breaks the streak going back.
    expect(computeWinStreak(trades)).toBe(3);
  });

  it("zero trades → streak of 0", () => {
    expect(computeWinStreak([])).toBe(0);
  });

  it("most recent is a loss → streak of 0", () => {
    const trades = [
      makeTrade({ id: "1", pnl: 100, exitTime: 100 }),
      makeTrade({ id: "2", pnl: -50, exitTime: 200 }),
    ];
    expect(computeWinStreak(trades)).toBe(0);
  });
});

describe("classifyTraderKind", () => {
  it("avg < 1h → Scalper", () => {
    const trades = [makeTrade({ duration: 30 * 60 })]; // 30 min
    expect(classifyTraderKind(trades)).toBe("Scalper");
  });

  it("avg < 1 day → Day Trader", () => {
    const trades = [makeTrade({ duration: 6 * 60 * 60 })]; // 6 hours
    expect(classifyTraderKind(trades)).toBe("Day Trader");
  });

  it("avg ≥ 1 day → Swing", () => {
    const trades = [makeTrade({ duration: 3 * 24 * 60 * 60 })]; // 3 days
    expect(classifyTraderKind(trades)).toBe("Swing");
  });

  it("zero trades → 'New Trader'", () => {
    expect(classifyTraderKind([])).toBe("New Trader");
  });
});

describe("formatters", () => {
  it("formatDuration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("0min");
    expect(formatDuration(45 * 60)).toBe("45min");
    expect(formatDuration(2 * 3600 + 14 * 60)).toBe("2h 14min");
  });

  it("formatPercent", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0.583)).toBe("58.3%");
    expect(formatPercent(0.5832, 2)).toBe("58.32%");
  });

  it("formatMoney", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(-50, true)).toBe("−$50.00");
    expect(formatMoney(50, true)).toBe("+$50.00");
  });
});
