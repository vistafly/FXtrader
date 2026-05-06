// v2.3 sub-phase 2B: waiting-room presence.
//
// Authorization: every mutation requires authed user (getAuthUserId).
// joinLobby is idempotent — re-joining updates the joinedAt timestamp
// rather than inserting a duplicate row.
//
// Lifecycle: rows are deleted on leaveLobby (unmount) and on
// startMatch (broadcast match start). Stale rows from clients that
// closed the tab without unmounting are pruned by `pruneStale` —
// rows older than ~2 minutes are considered abandoned.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { mutation, query } from "./_generated/server";

const STALE_MS = 120_000; // 2 minutes

export const joinLobby = mutation({
  args: {
    battleId: v.id("battles"),
    displayName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        kind: "unauthenticated",
        message: "Must be signed in",
      });
    }
    const existing = await ctx.db
      .query("lobbyMembers")
      .withIndex("by_battle_user", (q) =>
        q.eq("battleId", args.battleId).eq("userId", userId),
      )
      .first();
    const now = Date.now();
    if (existing) {
      // Refresh timestamp — keeps the user "fresh" if they revisit.
      await ctx.db.patch(existing._id, {
        joinedAt: now,
        displayName: args.displayName,
      });
      return existing._id;
    }
    return await ctx.db.insert("lobbyMembers", {
      battleId: args.battleId,
      userId,
      displayName: args.displayName,
      joinedAt: now,
    });
  },
});

export const leaveLobby = mutation({
  args: { battleId: v.id("battles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const existing = await ctx.db
      .query("lobbyMembers")
      .withIndex("by_battle_user", (q) =>
        q.eq("battleId", args.battleId).eq("userId", userId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/**
 * Reactive list of all lobby members for a battle. Subscribed in
 * the waiting-room UI; users see each other join/leave without
 * polling. Returns members fresher than `STALE_MS` to silently
 * drop ghost rows (closed tabs that didn't unmount cleanly).
 */
export const listLobbyMembers = query({
  args: { battleId: v.id("battles") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("lobbyMembers")
      .withIndex("by_battle", (q) => q.eq("battleId", args.battleId))
      .collect();
    const cutoff = Date.now() - STALE_MS;
    return all
      .filter((m) => m.joinedAt >= cutoff)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  },
});

/**
 * Creator-only broadcast: flip battle.startedAt to now. All clients
 * subscribed to the battle row pick this up and (joiners) auto-
 * redirect to their attempt's trade view. Lobby members table is
 * cleared.
 */
export const startMatch = mutation({
  args: { battleId: v.id("battles") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        kind: "unauthenticated",
        message: "Must be signed in",
      });
    }
    const battle = await ctx.db.get(args.battleId);
    if (!battle) {
      throw new ConvexError({
        kind: "battle-not-found",
        message: "Battle does not exist",
      });
    }
    if (battle.createdBy !== userId) {
      throw new ConvexError({
        kind: "forbidden",
        message: "Only the battle creator can start the match",
      });
    }
    if (battle.startedAt) {
      // Idempotent — already started.
      return battle.startedAt;
    }
    const now = Date.now();
    await ctx.db.patch(args.battleId, { startedAt: now });
    // Clear the lobby — match has begun.
    const members = await ctx.db
      .query("lobbyMembers")
      .withIndex("by_battle", (q) => q.eq("battleId", args.battleId))
      .collect();
    for (const m of members) {
      await ctx.db.delete(m._id);
    }
    return now;
  },
});
