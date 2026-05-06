// Convex mutations + queries for v2.3 in-flight battle attempts.
//
// Authorization model (mirrors convex/battles.ts):
//   - userId is taken from ctx.auth NEVER from args
//   - Every mutation requires authed user
//   - Mutations on a specific attempt verify the caller owns it
//
// Trust model (D3 = server-verified, log-only at v2.3):
//   - Client appends events as the user trades; server stores them
//   - Server CAN re-evaluate liquidation rules on each event and log
//     mismatches to attemptDiscrepancies (substrate for future
//     anti-cheat). At v2.3 the server does NOT block the attempt on
//     mismatch — that's the v2.x replay-log verification phase.
//
// Single-attempt enforcement (D2 = hard block):
//   - startAttempt rejects if a row exists with
//     (battleId, userId, status="in-flight") via the
//     by_battle_user_status index. Atomic within the mutation.
//   - "Abandon attempt" calls markAbandoned(attemptId) which flips
//     status to "abandoned"; the user can then call startAttempt
//     fresh. UI requires battle-name typing as friction (D2 refinement).
//
// Seq-contiguity (concern 3):
//   - appendEvent enforces seq === lastEventSeq + 1 (or seq === 0
//     for the first event). Mismatch → ConvexError. The client
//     queue treats this as fatal: surface "your attempt couldn't
//     be resumed due to a sync gap" rather than retrying blindly.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

async function requireAuthed(
  ctx: { auth: { getUserIdentity: () => Promise<unknown> } },
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) {
    throw new ConvexError({
      kind: "unauthenticated",
      message: "Must be signed in",
    });
  }
  return userId;
}

/**
 * D2: hard-block start. Reject if the (userId, battleId, status="in-flight")
 * tuple already exists. Returns the new attempt id.
 *
 * Provisional fields default to "no result yet"; markCompleted overwrites
 * them with the real values when the user Submits Final.
 */
export const startAttempt = mutation({
  args: {
    battleId: v.id("battles"),
    displayNameSnapshot: v.string(),
    startingBalance: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"battleAttempts">> => {
    const userId = await requireAuthed(ctx);

    // D2 enforcement: look up any in-flight row for this user+battle.
    const existing = await ctx.db
      .query("battleAttempts")
      .withIndex("by_battle_user_status", (q) =>
        q
          .eq("battleId", args.battleId)
          .eq("userId", userId)
          .eq("status", "in-flight" as const),
      )
      .first();
    if (existing) {
      throw new ConvexError({
        kind: "attempt-already-in-flight",
        attemptId: existing._id,
        message:
          "An in-flight attempt already exists for this battle. Resume it or abandon it before starting a new one.",
      });
    }

    const now = Date.now();
    return await ctx.db.insert("battleAttempts", {
      battleId: args.battleId,
      userId,
      displayNameSnapshot: args.displayNameSnapshot,
      finalBalance: args.startingBalance,
      pnlPct: 0,
      trades: 0,
      winRate: 0,
      disqualified: false,
      completedAt: 0,
      submittedAt: 0,
      status: "in-flight" as const,
      lastEventSeq: -1,
      startedAt: now,
    });
  },
});

/**
 * Append one event to the attempt's log. Enforces:
 *   - caller owns the attempt
 *   - attempt is currently in-flight (no appends to completed/abandoned)
 *   - seq === (current lastEventSeq + 1)  OR  (seq === 0 and lastEventSeq === -1)
 *
 * Mismatched seq throws ConvexError so the client queue treats it as
 * fatal rather than retrying. Silent recovery would let state drift.
 */
export const appendEvent = mutation({
  args: {
    attemptId: v.id("battleAttempts"),
    seq: v.number(),
    type: v.string(),
    payload: v.any(),
    time: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthed(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) {
      throw new ConvexError({
        kind: "attempt-not-found",
        message: "Attempt does not exist",
      });
    }
    if (attempt.userId !== userId) {
      throw new ConvexError({
        kind: "forbidden",
        message: "You do not own this attempt",
      });
    }
    if (attempt.status !== "in-flight") {
      throw new ConvexError({
        kind: "attempt-not-in-flight",
        status: attempt.status,
        message: `Cannot append events to a ${attempt.status ?? "completed"} attempt`,
      });
    }
    const expected = (attempt.lastEventSeq ?? -1) + 1;
    if (args.seq !== expected) {
      throw new ConvexError({
        kind: "seq-gap",
        expected,
        received: args.seq,
        message: `Event seq gap detected: expected ${expected}, received ${args.seq}`,
      });
    }
    await ctx.db.insert("attemptEvents", {
      attemptId: args.attemptId,
      seq: args.seq,
      type: args.type,
      payload: args.payload,
      time: args.time,
    });
    await ctx.db.patch(args.attemptId, {
      lastEventSeq: args.seq,
    });
  },
});

/**
 * Mark an in-flight attempt as abandoned. UI flow requires the user
 * to type the battle name to confirm before calling this (D2 refinement);
 * the server does not enforce that — it's a UX-layer affordance.
 *
 * After abandon: the attempt is no longer in-flight, the user is free
 * to startAttempt again, and the leaderboard shows nothing for this
 * abandoned row (queries filter on status="completed").
 */
export const markAbandoned = mutation({
  args: { attemptId: v.id("battleAttempts") },
  handler: async (ctx, args) => {
    const userId = await requireAuthed(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return;
    if (attempt.userId !== userId) {
      throw new ConvexError({
        kind: "forbidden",
        message: "You do not own this attempt",
      });
    }
    if (attempt.status !== "in-flight") return;
    await ctx.db.patch(args.attemptId, {
      status: "abandoned" as const,
      submittedAt: Date.now(),
    });
  },
});

/**
 * Finalize an in-flight attempt. The client computes final stats
 * (finalBalance/pnlPct/trades/winRate) by replaying its own event log
 * and passes them in. This mirrors the v2.2 trust model — server does
 * NOT recompute at v2.3. Bounds checks live in convex/battles.ts'
 * validateAttemptResultInline; we'd call it here once that's exposed
 * (deferred to sub-phase 2 wiring).
 */
export const markCompleted = mutation({
  args: {
    attemptId: v.id("battleAttempts"),
    finalBalance: v.number(),
    pnlPct: v.number(),
    trades: v.number(),
    winRate: v.number(),
    disqualified: v.boolean(),
    disqualificationReason: v.optional(v.string()),
    completedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuthed(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) {
      throw new ConvexError({
        kind: "attempt-not-found",
        message: "Attempt does not exist",
      });
    }
    if (attempt.userId !== userId) {
      throw new ConvexError({
        kind: "forbidden",
        message: "You do not own this attempt",
      });
    }
    if (attempt.status !== "in-flight") {
      throw new ConvexError({
        kind: "attempt-not-in-flight",
        status: attempt.status,
        message: "Attempt is not in-flight; cannot complete",
      });
    }
    await ctx.db.patch(args.attemptId, {
      status: "completed" as const,
      finalBalance: args.finalBalance,
      pnlPct: args.pnlPct,
      trades: args.trades,
      winRate: args.winRate,
      disqualified: args.disqualified,
      disqualificationReason: args.disqualificationReason,
      completedAt: args.completedAt,
      submittedAt: Date.now(),
    });
  },
});

/**
 * D3 (refinement): record a server/client liquidation-state mismatch
 * for later audit. Called by the server when its independent rule
 * re-check disagrees with the client's reported state. At v2.3 this
 * is log-only; v2.x anti-cheat phase will read from this table.
 */
export const recordDiscrepancy = mutation({
  args: {
    attemptId: v.id("battleAttempts"),
    eventSeq: v.number(),
    clientReportedDQ: v.boolean(),
    serverComputedDQ: v.boolean(),
    ruleBreached: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // No auth check: this is server-internal. Callers are other
    // Convex functions, not direct client requests.
    await ctx.db.insert("attemptDiscrepancies", {
      attemptId: args.attemptId,
      eventSeq: args.eventSeq,
      clientReportedDQ: args.clientReportedDQ,
      serverComputedDQ: args.serverComputedDQ,
      ruleBreached: args.ruleBreached,
      timestamp: Date.now(),
    });
  },
});

/** List all events for an attempt, in seq order. Used by the resume path. */
export const listEvents = query({
  args: { attemptId: v.id("battleAttempts") },
  handler: async (ctx, args) => {
    const userId = await requireAuthed(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return [];
    if (attempt.userId !== userId) {
      throw new ConvexError({
        kind: "forbidden",
        message: "You do not own this attempt",
      });
    }
    return await ctx.db
      .query("attemptEvents")
      .withIndex("by_attempt_seq", (q) => q.eq("attemptId", args.attemptId))
      .collect();
  },
});

/**
 * Find this user's in-flight attempt for a battle, if any. Returns
 * null when there isn't one. UI uses this to decide between "Start"
 * (no in-flight) and "Resume" (in-flight exists).
 */
export const getActiveAttempt = query({
  args: { battleId: v.id("battles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("battleAttempts")
      .withIndex("by_battle_user_status", (q) =>
        q
          .eq("battleId", args.battleId)
          .eq("userId", userId)
          .eq("status", "in-flight" as const),
      )
      .first();
  },
});

/**
 * v2.3 sub-phase 4: live P&L update for in-flight attempts. Trade
 * page calls this on a heartbeat interval (~5s) so other clients'
 * leaderboard live queries reflect this user's current balance
 * without waiting for submission. No-ops when the attempt isn't
 * in-flight — we never overwrite finalized stats.
 *
 * Auth: caller must own the attempt. Same enforcement as
 * appendEvent. Cheap mutation — just a patch — but let's not
 * burn through Convex's free tier with malicious clients writing
 * to other users' rows.
 */
export const updateLivePnl = mutation({
  args: {
    attemptId: v.id("battleAttempts"),
    finalBalance: v.number(),
    pnlPct: v.number(),
    /** v2.3 sub-phase 4: total live trade count (open positions +
     *  closed trades). Drives the leaderboard's "In flight"
     *  (no trades yet) vs "Active / ranked" (has trades) split. */
    trades: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return;
    if (attempt.userId !== userId) return;
    if (attempt.status !== "in-flight") return;
    await ctx.db.patch(args.attemptId, {
      finalBalance: args.finalBalance,
      pnlPct: args.pnlPct,
      trades: args.trades,
    });
  },
});

/**
 * v2.3 sub-phase 3: find this user's MOST RECENT attempt for a battle
 * regardless of status. Used by the WaitingRoom to detect completed
 * attempts and disable the "Start match" CTA — preventing duplicate
 * submissions to the same battle. Returns null if the user has no
 * attempts (in-flight or otherwise) for this battle.
 *
 * Returned-row precedence (highest first):
 *   in-flight > completed > abandoned
 * So if a user has an in-flight AND a prior abandoned, we return the
 * in-flight (matches getActiveAttempt's intent for a single source).
 */
export const getMyAttempt = query({
  args: { battleId: v.id("battles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const all = await ctx.db
      .query("battleAttempts")
      .withIndex("by_battle_user", (q) =>
        q.eq("battleId", args.battleId).eq("userId", userId),
      )
      .collect();
    if (all.length === 0) return null;
    // Prefer in-flight, then most recent completed, then abandoned.
    const inFlight = all.find((a) => a.status === "in-flight");
    if (inFlight) return inFlight;
    const completed = all
      .filter((a) => a.status === "completed")
      .sort((a, b) => b.submittedAt - a.submittedAt)[0];
    if (completed) return completed;
    return all[0];
  },
});
