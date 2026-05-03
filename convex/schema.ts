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
    instrument: v.string(),
    startBarTime: v.number(),
    durationBars: v.number(),
    startingBalance: v.number(),
    rules: v.object({
      maxDrawdownPct: v.optional(v.number()),
      maxLossPerTradePct: v.optional(v.number()),
      requireStopLoss: v.optional(v.boolean()),
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
  })
    .index("by_battleId", ["battleId"])
    .index("by_battle_user", ["battleId", "userId"])
    .index("by_user", ["userId"]),
});
