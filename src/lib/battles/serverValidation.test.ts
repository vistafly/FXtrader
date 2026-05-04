import { describe, expect, it } from "vitest";

import { validateAttemptResult } from "./serverValidation";

const VALID = {
  startingBalance: 10000,
  finalBalance: 13500, // +35%
  pnlPct: 35,
  trades: 10,
  winRate: 0.6,
};

describe("validateAttemptResult — happy paths", () => {
  it("accepts a consistent winning attempt", () => {
    expect(validateAttemptResult(VALID)).toBeNull();
  });
  it("accepts a consistent losing attempt", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 8000,
        pnlPct: -20,
      }),
    ).toBeNull();
  });
  it("accepts a flat attempt (0% pnl)", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 10000,
        pnlPct: 0,
        trades: 0,
        winRate: 0,
      }),
    ).toBeNull();
  });
  it("accepts an attempt at the bounds — full liquidation", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 0,
        pnlPct: -100,
      }),
    ).toBeNull();
  });
});

describe("validateAttemptResult — finite-number gate", () => {
  it("rejects NaN startingBalance", () => {
    expect(validateAttemptResult({ ...VALID, startingBalance: NaN })).toMatch(
      /starting balance/i,
    );
  });
  it("rejects zero startingBalance (would divide by zero)", () => {
    expect(validateAttemptResult({ ...VALID, startingBalance: 0 })).toMatch(
      /starting balance/i,
    );
  });
  it("rejects negative startingBalance", () => {
    expect(validateAttemptResult({ ...VALID, startingBalance: -1 })).toMatch(
      /starting balance/i,
    );
  });
  it("rejects Infinity finalBalance", () => {
    expect(
      validateAttemptResult({ ...VALID, finalBalance: Infinity }),
    ).toMatch(/final balance/i);
  });
  it("rejects NaN pnlPct", () => {
    expect(validateAttemptResult({ ...VALID, pnlPct: NaN })).toMatch(/P&L/i);
  });
  it("rejects non-integer trades", () => {
    expect(validateAttemptResult({ ...VALID, trades: 3.5 })).toMatch(
      /trade count/i,
    );
  });
  it("rejects negative trades", () => {
    expect(validateAttemptResult({ ...VALID, trades: -1 })).toMatch(
      /trade count/i,
    );
  });
});

describe("validateAttemptResult — bounds", () => {
  it("rejects pnlPct below -100", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: -200,
        pnlPct: -102,
      }),
    ).toMatch(/range/i);
  });
  it("rejects pnlPct above 1000", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 1_500_000,
        pnlPct: 14_900,
      }),
    ).toMatch(/range/i);
  });
  it("rejects winRate above 1", () => {
    expect(validateAttemptResult({ ...VALID, winRate: 1.5 })).toMatch(
      /win rate/i,
    );
  });
  it("rejects winRate below 0", () => {
    expect(validateAttemptResult({ ...VALID, winRate: -0.1 })).toMatch(
      /win rate/i,
    );
  });
});

describe("validateAttemptResult — math consistency (the tampering catch)", () => {
  it("rejects mismatched pnlPct (final says +35%, pnlPct says +50%)", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 13500, // actually +35%
        pnlPct: 50, // claimed
      }),
    ).toMatch(/does not match/i);
  });
  it("rejects mismatch the other direction (final says +35%, pnlPct says +20%)", () => {
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 13500,
        pnlPct: 20,
      }),
    ).toMatch(/does not match/i);
  });
  it("accepts pnlPct within 0.5pp epsilon (legitimate rounding)", () => {
    // Off by 0.3 percentage points — within tolerance.
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 13500,
        pnlPct: 35.3,
      }),
    ).toBeNull();
  });
  it("rejects pnlPct just past the epsilon boundary", () => {
    // Off by 0.6 percentage points — past 0.5 tolerance.
    expect(
      validateAttemptResult({
        ...VALID,
        finalBalance: 13500,
        pnlPct: 35.6,
      }),
    ).toMatch(/does not match/i);
  });
});
