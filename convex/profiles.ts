// Convex profile mutations + queries.
//
// The auth `users` table holds email/password-hash. Display names live here
// in `profiles`, separated because:
//   - Profiles are the human-facing identity (rename without invalidating
//     the auth row).
//   - Foreign keys across all v2 tables point at users._id (stable), with
//     `displayNameSnapshot` columns capturing the name at moment-of-write.
//
// Validation rules:
//   - 3-20 chars, [A-Za-z0-9_-]. No spaces, no symbols, no emoji. Keeps
//     leaderboards readable across mono fonts and avoids URL-escape pain
//     if we later expose @username paths.
//   - Globally unique, case-insensitive (per O2). Stored as-typed for
//     display, with `displayNameLower` for the uniqueness check.
//   - Renaming is rate-limited to once per 7 days (per A4). Stops people
//     from churning names mid-battle to confuse the leaderboard.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DISPLAY_NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

function assertValidDisplayName(name: string): void {
  if (!DISPLAY_NAME_RE.test(name)) {
    throw new ConvexError(
      "Display name must be 3–20 characters: letters, numbers, _ or -",
    );
  }
}

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
  },
});

export const createProfile = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Must be signed in to create a profile");
    }
    assertValidDisplayName(displayName);

    // Idempotency guard: the UI should call this exactly once after signup,
    // but a refresh between signIn and createProfile could replay the call.
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      throw new ConvexError("Profile already exists for this user");
    }

    const displayNameLower = displayName.toLowerCase();
    const conflict = await ctx.db
      .query("profiles")
      .withIndex("by_displayNameLower", (q) =>
        q.eq("displayNameLower", displayNameLower),
      )
      .unique();
    if (conflict) {
      throw new ConvexError(`Display name "${displayName}" is already taken`);
    }

    const now = Date.now();
    return await ctx.db.insert("profiles", {
      userId,
      displayName,
      displayNameLower,
      createdAt: now,
      lastDisplayNameChangeAt: now,
    });
  },
});

// Internal-only — invoked from convex/auth.ts's afterUserCreatedOrUpdated
// callback to write the profile row atomically with auth user creation.
// Eliminates the WebSocket auth-refresh race that broke the v2.1 client-side
// flow. Validation already happened in Password.profile() so we just check
// idempotency + uniqueness here.
export const createProfileForUser = internalMutation({
  args: {
    userId: v.id("users"),
    displayName: v.string(),
  },
  handler: async (ctx, { userId, displayName }) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return;

    const displayNameLower = displayName.toLowerCase();
    const conflict = await ctx.db
      .query("profiles")
      .withIndex("by_displayNameLower", (q) =>
        q.eq("displayNameLower", displayNameLower),
      )
      .unique();
    if (conflict) {
      // Race: name was free at form-validation time, taken by the time we
      // tried to insert. Leave profile uncreated; /signup recovery mode
      // (authed but no profile) will prompt the user to pick a new name.
      return;
    }

    const now = Date.now();
    await ctx.db.insert("profiles", {
      userId,
      displayName,
      displayNameLower,
      createdAt: now,
      lastDisplayNameChangeAt: now,
    });
  },
});

export const updateDisplayName = mutation({
  args: { displayName: v.string() },
  handler: async (ctx, { displayName }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Must be signed in");
    }
    assertValidDisplayName(displayName);

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) {
      throw new ConvexError("No profile to update; create one first");
    }

    const now = Date.now();
    const elapsed = now - profile.lastDisplayNameChangeAt;
    if (elapsed < SEVEN_DAYS_MS) {
      const daysLeft = Math.ceil((SEVEN_DAYS_MS - elapsed) / ONE_DAY_MS);
      throw new ConvexError(
        `Display name can be changed once per 7 days. Try again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
      );
    }

    const displayNameLower = displayName.toLowerCase();
    if (displayNameLower !== profile.displayNameLower) {
      const conflict = await ctx.db
        .query("profiles")
        .withIndex("by_displayNameLower", (q) =>
          q.eq("displayNameLower", displayNameLower),
        )
        .unique();
      if (conflict) {
        throw new ConvexError(
          `Display name "${displayName}" is already taken`,
        );
      }
    }

    await ctx.db.patch(profile._id, {
      displayName,
      displayNameLower,
      lastDisplayNameChangeAt: now,
    });
  },
});
