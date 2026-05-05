// Convex schema — v2 multiplayer backend.
//
// Per the Phase v2.1 plan (CLAUDE.md §16.1):
//
//   - profiles: per-user display name. The auth `users` table (from authTables)
//     holds email/password-hash; profiles holds the human-facing name.
//     Foreign key is `userId: v.id("users")` — the stable Convex auth id, NOT
//     the profile _id (which is recreatable).
//
//   - battles: server-owned battle definitions, with public/invite-only
//     visibility. `createdBySnapshot` is the creator's display name AT
//     CREATION TIME so renames don't retroactively rewrite history.
//
//   - battleAttempts: one row per completed attempt. `displayNameSnapshot`
//     same reasoning. Many attempts allowed per (userId, battleId); the
//     leaderboard query aggregates by userId and shows best (per O1).
//
//     Two distinct timestamps:
//       - completedAt: simulated bar time (engine clock) — for sorting
//         leaderboard rows alongside v1's existing BattleAttempt records.
//       - submittedAt: server Date.now() — for "recent activity" feeds
//         and rate-limiting (e.g. detecting submission floods).
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  profiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    displayNameLower: v.string(),
    createdAt: v.number(),
    lastDisplayNameChangeAt: v.number(),
  })
    .index("by_displayNameLower", ["displayNameLower"])
    .index("by_userId", ["userId"]),

  battles: defineTable({
    name: v.string(),
    // v2.2: list of 1-5 instruments the battle is configured for.
    // FORM-ONLY multi-asset in v2.2 — schema accepts the array, but the
    // trade view uses instruments[0] at attempt start. Full multi-asset
    // (per-instrument switching during play) is v2.2.5. The schema shape
    // is the v2.2.5-ready version so v2.2.5's work is purely client/UI;
    // no schema migration needed at that point.
    instruments: v.array(v.string()),
    startBarTime: v.number(),
    // v2.2: stored in minutes. Translated to bars at session start
    // (1 bar/sec at 1× speed → 60 bars per minute).
    durationMinutes: v.number(),
    startingBalance: v.number(),
    // v2.2: cap on distinct userIds that can submit attempts. Enforced
    // at submitAttempt by counting distinct prior attempt userIds.
    maxParticipants: v.number(),
    rules: v.object({
      maxDrawdownPct: v.optional(v.number()),
      maxLossPerTradePct: v.optional(v.number()),
      requireStopLoss: v.optional(v.boolean()),
      // v2.2: optional profit-target. Display only — no auto-end of
      // attempts on hit. Leaderboard surfaces a "target hit" badge for
      // attempts whose final pnlPct >= profitTargetPct.
      profitTargetPct: v.optional(v.number()),
    }),
    visibility: v.union(v.literal("invite-only"), v.literal("public")),
    inviteCode: v.optional(v.string()),
    expiresAt: v.number(),
    createdBy: v.id("users"),
    createdBySnapshot: v.string(),
    createdAt: v.number(),
  })
    .index("by_visibility", ["visibility"])
    .index("by_inviteCode", ["inviteCode"])
    .index("by_createdBy", ["createdBy"]),

  battleAttempts: defineTable({
    battleId: v.id("battles"),
    userId: v.id("users"),
    displayNameSnapshot: v.string(),
    finalBalance: v.number(),
    pnlPct: v.number(),
    trades: v.number(),
    winRate: v.number(),
    disqualified: v.boolean(),
    disqualificationReason: v.optional(v.string()),
    completedAt: v.number(),
    submittedAt: v.number(),
    // v2.3: lifecycle status. "in-flight" rows are resumable attempts
    // with provisional `finalBalance`/`pnlPct`/`trades`/`winRate`
    // (overwritten when the user explicitly Submits Final). Rows
    // without `status` are pre-v2.3 attempts and treated as
    // "completed" by code that reads this field.
    status: v.optional(
      v.union(
        v.literal("in-flight"),
        v.literal("completed"),
        v.literal("abandoned"),
      ),
    ),
    /** v2.3: monotonic sequence number of the last appended event for
     *  this attempt. Reducer enforces contiguous +1 increments on
     *  resume; gap → ReducerSeqGapError. */
    lastEventSeq: v.optional(v.number()),
    /** v2.3: server-side wall-clock time the attempt was first
     *  started. Distinct from `submittedAt` (final submission time). */
    startedAt: v.optional(v.number()),
  })
    .index("by_battleId", ["battleId"])
    .index("by_battle_user", ["battleId", "userId"])
    .index("by_user", ["userId"])
    // v2.2: composite index for snapshot-leaderboard queries that
    // sort attempts within a battle by completion time. Aggregation
    // to "best-per-user" happens client-side in lib/battles/leaderboard.ts.
    .index("by_battle_completed", ["battleId", "completedAt"])
    // v2.3: index for D2 single-attempt enforcement — looking up
    // the user's in-flight attempt for a given battle. Status is
    // included so the lookup matches only "in-flight" rows.
    .index("by_battle_user_status", ["battleId", "userId", "status"]),

  // v2.3: typed event log per attempt. Client appends events as the
  // user trades; resume = fetch all events for the attempt + replay
  // through the pure AttemptReducer in src/lib/events. Spectator
  // (v2.4) and replay-log anti-cheat (BACKLOG) read from the same
  // table — building once, reusing thrice.
  //
  // Seq is enforced contiguous-+1-per-attempt by the appendEvent
  // mutation. The reducer throws ReducerSeqGapError on missing seq
  // numbers rather than silently drifting state.
  attemptEvents: defineTable({
    attemptId: v.id("battleAttempts"),
    seq: v.number(),
    type: v.string(),
    payload: v.any(),
    /** UTC unix-second replay time the event represents. Distinct
     *  from `_creationTime` which is wall-clock when the event landed
     *  on the server. */
    time: v.number(),
  })
    .index("by_attempt_seq", ["attemptId", "seq"])
    .index("by_attempt", ["attemptId"]),

  // v2.3 (D3 refinement): server-side liquidation re-check log. When
  // the server independently evaluates drawdown rules on an event and
  // its result disagrees with the client's reported state, a row
  // lands here. Audit substrate for the future anti-cheat phase; at
  // v2.3 this is log-only — does NOT block the attempt.
  attemptDiscrepancies: defineTable({
    attemptId: v.id("battleAttempts"),
    eventSeq: v.number(),
    clientReportedDQ: v.boolean(),
    serverComputedDQ: v.boolean(),
    ruleBreached: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_attempt", ["attemptId"]),
});
