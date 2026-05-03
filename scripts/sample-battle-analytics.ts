/**
 * Phase 7 gate proof — battle leaderboard.
 *
 * Seeds an in-memory battle + 4 attempts (3 normal + 1 DQ'd), runs the
 * leaderboard helper, and prints the rankings. Confirms:
 *   • Sort by pnlPct descending
 *   • Tie-break by completedAt ascending
 *   • DQ excluded from rankings, but visible in the attempt list
 *
 * Pure-Node — no IndexedDB / browser.
 */

import {
  bestAttempt,
  countDisqualified,
  rankAttempts,
} from "../src/lib/battles/leaderboard";
import type { Battle, BattleAttempt } from "../src/types/battle";

const battle: Battle = {
  id: "b-sample",
  name: "EUR breakout drill",
  instrument: "EURUSD",
  startBarTime: 1_700_000_000,
  durationBars: 1000,
  startingBalance: 10_000,
  rules: {
    maxDrawdownPct: 0.10,
    requireStopLoss: true,
  },
  attempts: [],
};

const attempts: BattleAttempt[] = [
  {
    id: "a1",
    battleId: battle.id,
    sessionId: "s1",
    finalBalance: 10_320,
    pnlPct: 0.032,
    trades: 8,
    winRate: 0.625,
    completedAt: 1_700_002_000,
    disqualified: false,
  },
  {
    id: "a2",
    battleId: battle.id,
    sessionId: "s2",
    finalBalance: 10_580,
    pnlPct: 0.058,
    trades: 12,
    winRate: 0.583,
    completedAt: 1_700_004_000,
    disqualified: false,
  },
  {
    id: "a3",
    battleId: battle.id,
    sessionId: "s3",
    finalBalance: 10_580, // tied with a2 on pnl
    pnlPct: 0.058,        // tied on pct → tie-break by completedAt (earlier wins)
    trades: 9,
    winRate: 0.667,
    completedAt: 1_700_003_000, // earlier than a2 → ranks higher
    disqualified: false,
  },
  {
    id: "a4-dq",
    battleId: battle.id,
    sessionId: "s4",
    finalBalance: 8_900,    // would be the lowest pct anyway
    pnlPct: -0.11,
    trades: 4,
    winRate: 0.25,
    completedAt: 1_700_005_000,
    disqualified: true,
    disqualificationReason: "Max drawdown exceeded — equity $8,900.00 dropped past the 10.0% threshold ($9,000.00).",
  },
];

console.log("=".repeat(72));
console.log("Phase 7 — sample battle leaderboard");
console.log("=".repeat(72));
console.log(`Battle: ${battle.name} (${battle.instrument})`);
console.log(`Rules:  maxDrawdown ${(battle.rules.maxDrawdownPct! * 100).toFixed(0)}%${battle.rules.requireStopLoss ? " · SL required" : ""}`);
console.log(`Seeded: ${attempts.length} attempts (3 normal + 1 DQ)`);
console.log();

const ranked = rankAttempts(attempts);
const dqs = attempts.filter((a) => a.disqualified);
const dqCount = countDisqualified(attempts);
const top = bestAttempt(attempts);

console.log(`LEADERBOARD  (${ranked.length} ranked, ${dqCount} disqualified):`);
console.log("  rank  attemptId   pnl%      finalBal    trades  winRate  completedAt");
console.log("  " + "-".repeat(70));
ranked.forEach((a, i) => {
  const date = new Date(a.completedAt * 1000).toISOString().slice(0, 16).replace("T", " ");
  console.log(
    `  ${(i + 1).toString().padStart(4)}  ${a.id.padEnd(10)} ${(a.pnlPct >= 0 ? "+" : "") + (a.pnlPct * 100).toFixed(2)}%   $${a.finalBalance.toFixed(2).padStart(9)}  ${a.trades.toString().padStart(6)}  ${(a.winRate * 100).toFixed(1).padStart(5)}%  ${date}`,
  );
});
console.log();

console.log("DISQUALIFIED  (excluded from leaderboard, kept on record):");
for (const a of dqs) {
  console.log(`  ${a.id}  ${a.disqualificationReason ?? "(no reason)"}`);
  console.log(`     pnl=${(a.pnlPct >= 0 ? "+" : "") + (a.pnlPct * 100).toFixed(2)}%  finalBal=$${a.finalBalance.toFixed(2)}`);
}
console.log();

console.log("Best attempt: " + (top ? `${top.id}  +${(top.pnlPct * 100).toFixed(2)}%` : "(none — only DQs)"));
console.log();

// Verification asserts (gate proof — fails the script if logic regressed)
const assertEq = (name: string, actual: unknown, expected: unknown) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`  ASSERT FAIL  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
};
console.log("Assertions:");
assertEq("ranked length excludes DQ", ranked.length, 3);
assertEq("ranked first id (a3 wins tie-break)", ranked[0].id, "a3");
assertEq("ranked second id (a2)", ranked[1].id, "a2");
assertEq("ranked third id (a1)", ranked[2].id, "a1");
assertEq("DQ count", dqCount, 1);
assertEq("DQ id present in list", dqs[0].id, "a4-dq");
assertEq("Best attempt id", top?.id, "a3");
console.log();
console.log("=".repeat(72));
console.log("Phase 7 gate proof: leaderboard logic verified.");
console.log("=".repeat(72));
