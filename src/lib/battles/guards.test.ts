import { describe, expect, it } from "vitest";

import { EURUSD } from "@/lib/instruments/instruments";
import type { Battle } from "@/types/battle";

import {
  checkBattleRule,
  checkMaxDrawdown,
  computeMaxLossUsd,
  type SubmittableOrderDraft,
} from "./guards";
import { bestAttempt, countDisqualified, rankAttempts } from "./leaderboard";

const battle = (rules: Battle["rules"]): Battle => ({
  id: "b1",
  name: "Test battle",
  instrument: "EURUSD",
  startBarTime: 1_700_000_000,
  durationBars: 1000,
  startingBalance: 10_000,
  rules,
  attempts: [],
});

const draft = (over: Partial<SubmittableOrderDraft> = {}): SubmittableOrderDraft => ({
  side: "buy",
  type: "limit",
  size: 1,
  limitPrice: 1.10,
  ...over,
});

describe("battle guards — order-time rules", () => {
  it("requireStopLoss → blocks when SL is missing", () => {
    const v = checkBattleRule(draft({ stopLoss: undefined }), {
      battle: battle({ requireStopLoss: true }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toMatch(/stop loss/i);
  });

  it("requireStopLoss → passes when SL is set", () => {
    const v = checkBattleRule(draft({ stopLoss: 1.095 }), {
      battle: battle({ requireStopLoss: true }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toBeNull();
  });

  it("maxLossPerTradePct → blocks when SL implies loss > cap", () => {
    // Long limit @ 1.10, SL @ 1.05 → 50 pip loss * $10/pip = $500
    // Cap at 1% of $10,000 = $100. Should block.
    const v = checkBattleRule(draft({ limitPrice: 1.10, stopLoss: 1.05 }), {
      battle: battle({ maxLossPerTradePct: 0.01 }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toMatch(/max loss/i);
  });

  it("maxLossPerTradePct → passes when SL implies loss within cap", () => {
    // Long @ 1.10, SL @ 1.0995 → 5-pip loss * $10/pip = $50. Cap 1% = $100. OK.
    const v = checkBattleRule(draft({ limitPrice: 1.10, stopLoss: 1.0995 }), {
      battle: battle({ maxLossPerTradePct: 0.01 }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toBeNull();
  });

  it("maxLossPerTradePct → exact-cap edge case (loss == cap) is allowed", () => {
    // Long @ 1.10, SL @ 1.099 → 10 pips * $10 = $100 loss. Cap = $100 exactly.
    // Floating-point error pushes max slightly above cap; the rounded compare
    // should treat $100.0000…112 as equal to $100 and let it through.
    const v = checkBattleRule(draft({ limitPrice: 1.10, stopLoss: 1.099 }), {
      battle: battle({ maxLossPerTradePct: 0.01 }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toBeNull();
  });

  it("maxLossPerTradePct → blocks when SL is missing (unbounded loss)", () => {
    const v = checkBattleRule(draft({ stopLoss: undefined }), {
      battle: battle({ maxLossPerTradePct: 0.02 }),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toMatch(/set a stop loss/i);
  });

  it("no rules → no violation", () => {
    const v = checkBattleRule(draft({ stopLoss: undefined }), {
      battle: battle({}),
      instrument: EURUSD,
      currentBalance: 10_000,
    });
    expect(v).toBeNull();
  });
});

describe("computeMaxLossUsd", () => {
  it("returns null when SL undefined", () => {
    expect(computeMaxLossUsd(draft({ stopLoss: undefined }), EURUSD)).toBeNull();
  });

  it("returns 0 for market orders without a pivot (SL clamp absorbs the risk)", () => {
    expect(
      computeMaxLossUsd({ ...draft({ type: "market", stopLoss: 1.099 }) }, EURUSD),
    ).toBe(0);
  });

  it("computes USD loss for a limit buy with SL", () => {
    // 1.10 → 1.099 is 10 pips on EURUSD → 10 * $10/pip = $100 on a 1-lot.
    expect(
      computeMaxLossUsd(draft({ type: "limit", limitPrice: 1.10, stopLoss: 1.099 }), EURUSD),
    ).toBeCloseTo(100, 6);
  });
});

describe("checkMaxDrawdown — mid-session check", () => {
  it("threshold computed from BATTLE startingBalance, not session", () => {
    // Battle starts with $10k, max drawdown 20% → threshold $8k.
    const b = battle({ maxDrawdownPct: 0.2 });
    expect(checkMaxDrawdown(b, 8_500)).toBeNull(); // above threshold
    expect(checkMaxDrawdown(b, 8_000)).toMatch(/max drawdown/i); // exactly at threshold → fail
    expect(checkMaxDrawdown(b, 7_500)).toMatch(/max drawdown/i);
  });

  it("no rule → never flags", () => {
    expect(checkMaxDrawdown(battle({}), 0)).toBeNull();
  });
});

describe("leaderboard — rank + DQ exclusion", () => {
  const attempt = (over: Partial<{ id: string; pnlPct: number; disqualified: boolean; completedAt: number }>) => ({
    id: over.id ?? "a",
    battleId: "b1",
    sessionId: "s1",
    finalBalance: 10_000,
    pnlPct: over.pnlPct ?? 0,
    trades: 0,
    winRate: 0,
    completedAt: over.completedAt ?? 1_700_000_000,
    disqualified: over.disqualified ?? false,
  });

  it("ranks by pnlPct descending", () => {
    const ranked = rankAttempts([
      attempt({ id: "a1", pnlPct: 0.05 }),
      attempt({ id: "a2", pnlPct: 0.10 }),
      attempt({ id: "a3", pnlPct: 0.02 }),
    ]);
    expect(ranked.map((a) => a.id)).toEqual(["a2", "a1", "a3"]);
  });

  it("excludes DQ'd attempts entirely", () => {
    const ranked = rankAttempts([
      attempt({ id: "a1", pnlPct: 0.20, disqualified: true }), // would-be 1st but DQ
      attempt({ id: "a2", pnlPct: 0.05 }),
      attempt({ id: "a3", pnlPct: 0.10 }),
    ]);
    expect(ranked.map((a) => a.id)).toEqual(["a3", "a2"]);
    expect(ranked.find((a) => a.id === "a1")).toBeUndefined();
  });

  it("ties broken by earliest completedAt", () => {
    const ranked = rankAttempts([
      attempt({ id: "a1", pnlPct: 0.05, completedAt: 200 }),
      attempt({ id: "a2", pnlPct: 0.05, completedAt: 100 }), // earlier wins
      attempt({ id: "a3", pnlPct: 0.05, completedAt: 300 }),
    ]);
    expect(ranked.map((a) => a.id)).toEqual(["a2", "a1", "a3"]);
  });

  it("countDisqualified", () => {
    expect(
      countDisqualified([
        attempt({ disqualified: true }),
        attempt({ disqualified: false }),
        attempt({ disqualified: true }),
      ]),
    ).toBe(2);
  });

  it("bestAttempt — returns top-ranked or null when only DQs", () => {
    expect(
      bestAttempt([attempt({ id: "a1", pnlPct: 0.10 })])?.id,
    ).toBe("a1");
    expect(
      bestAttempt([attempt({ id: "a1", disqualified: true })]),
    ).toBeNull();
    expect(bestAttempt([])).toBeNull();
  });
});
