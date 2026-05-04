// Convex mutations + queries for v2.2 server battles.
//
// Authorization model (per A1):
//   - userId is taken from ctx.auth NEVER from args. The args validators
//     don't accept userId as a parameter at all — Convex would reject
//     such an arg as unknown. This is the most important security
//     invariant in the file.
//   - Every mutation requires authed user (getAuthUserId !== null).
//   - Every mutation also requires the user to have a profile (display
//     name set). "Authed but no profile" → ConvexError with a friendly
//     message that the UI uses to route to /signup recovery.
//
// Trust model (per A2, confirming §16.1):
//   - Server trusts the client's reported attempt result. NO replay
//     verification, NO server-side recomputation against stored bars.
//     Documented here so future-us doesn't quietly drop this assumption
//     when seeing the math-consistency check below — that check is
//     bounds + internal-consistency only, NOT cheat prevention.
//   - The bounds + internal-consistency checks live in
//     src/lib/battles/serverValidation.ts (with tests). Mirrored inline
//     below since convex/ runs in its own runtime.
//
// Visibility model (per A3):
//   - "public" battles are listed in /battles lobby for anyone authed.
//   - "invite-only" battles are NOT listed; access is via inviteCode
//     lookup only.
//   - !!! IMPORTANT !!! Battle IDs are 32-char Convex IDs and are not
//     enumerable in practice, but they are NOT access-controlled.
//     Anyone authed who obtains a battle ID (via screenshot, shared
//     URL, browser history, etc.) can read the battle. This is
//     acceptable for friends-only scale. When opening to public
//     lobbies, add row-level access control via an allowedUsers
//     junction table. Tracked in BACKLOG.md.
//
// Rate limiting (per the user's addition):
//   - submitAttempt rejects if the same userId has submitted to the
//     same battleId within the last 10 seconds. This is operational
//     hygiene (catches double-clicks, retry loops, free-tier quota
//     burnthrough), NOT cheat prevention. Different concept.
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 10_000;

const PNL_PCT_EPSILON = 0.5;
const PNL_PCT_MIN = -100;
const PNL_PCT_MAX = 1000;

// Mirror of src/lib/battles/serverValidation.ts:validateAttemptResult.
// Inlined because convex/ can't import from src/. Tests on the src/
// copy document the contract; keep these in sync.
function validateAttemptResultInline(args: {
  startingBalance: number;
  finalBalance: number;
  pnlPct: number;
  trades: number;
  winRate: number;
}): string | null {
  const { startingBalance, finalBalance, pnlPct, trades, winRate } = args;
  if (!Number.isFinite(startingBalance) || startingBalance <= 0)
    return "Invalid starting balance.";
  if (!Number.isFinite(finalBalance)) return "Invalid final balance.";
  if (!Number.isFinite(pnlPct)) return "Invalid P&L percentage.";
  if (!Number.isFinite(trades) || !Number.isInteger(trades) || trades < 0)
    return "Invalid trade count.";
  if (!Number.isFinite(winRate)) return "Invalid win rate.";
  if (pnlPct < PNL_PCT_MIN || pnlPct > PNL_PCT_MAX)
    return `P&L percentage out of range [${PNL_PCT_MIN}, ${PNL_PCT_MAX}].`;
  if (winRate < 0 || winRate > 1)
    return "Win rate must be between 0 and 1.";
  const expected = ((finalBalance - startingBalance) / startingBalance) * 100;
  if (Math.abs(pnlPct - expected) > PNL_PCT_EPSILON)
    return "P&L percentage does not match balance change.";
  return null;
}

// Mirror of src/lib/battles/inviteCode.ts:generateInviteCode.
// Same alphabet, same length default. Convex runtime exposes
// Web Crypto via globalThis.crypto.
const INVITE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function generateInviteCode(length = 12): string {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

async function requireUserWithProfile(ctx: MutationCtx): Promise<{
  userId: Id<"users">;
  displayName: string;
}> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("You must be signed in.");
  }
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (!profile) {
    throw new ConvexError(
      "You need to set a display name before joining battles.",
    );
  }
  return { userId, displayName: profile.displayName };
}

// =============================================================
// Mutations
// =============================================================

export const createBattle = mutation({
  args: {
    name: v.string(),
    instruments: v.array(v.string()),
    startBarTime: v.number(),
    durationMinutes: v.number(),
    startingBalance: v.number(),
    maxParticipants: v.number(),
    rules: v.object({
      maxDrawdownPct: v.optional(v.number()),
      maxLossPerTradePct: v.optional(v.number()),
      requireStopLoss: v.optional(v.boolean()),
      profitTargetPct: v.optional(v.number()),
    }),
    visibility: v.union(v.literal("public"), v.literal("invite-only")),
  },
  handler: async (ctx, args) => {
    const { userId, displayName } = await requireUserWithProfile(ctx);

    if (!args.name.trim()) throw new ConvexError("Battle name is required.");
    if (args.startingBalance <= 0)
      throw new ConvexError("Starting balance must be positive.");
    if (args.durationMinutes <= 0)
      throw new ConvexError("Duration must be positive.");
    if (args.maxParticipants <= 0)
      throw new ConvexError("Max participants must be positive.");
    if (args.instruments.length < 1 || args.instruments.length > 5) {
      throw new ConvexError("Battles must have between 1 and 5 instruments.");
    }
    // De-dupe defensively (UI should prevent but enforce server-side too).
    const dedupedInstruments = Array.from(new Set(args.instruments));
    if (dedupedInstruments.length !== args.instruments.length) {
      throw new ConvexError("Duplicate instruments are not allowed.");
    }

    const now = Date.now();
    const inviteCode = generateInviteCode();

    return await ctx.db.insert("battles", {
      name: args.name.trim(),
      instruments: args.instruments,
      startBarTime: args.startBarTime,
      durationMinutes: args.durationMinutes,
      startingBalance: args.startingBalance,
      maxParticipants: args.maxParticipants,
      rules: args.rules,
      visibility: args.visibility,
      inviteCode,
      expiresAt: now + SEVEN_DAYS_MS,
      createdBy: userId,
      createdBySnapshot: displayName,
      createdAt: now,
    });
  },
});

export const submitAttempt = mutation({
  args: {
    battleId: v.id("battles"),
    finalBalance: v.number(),
    pnlPct: v.number(),
    trades: v.number(),
    winRate: v.number(),
    disqualified: v.boolean(),
    disqualificationReason: v.optional(v.string()),
    completedAt: v.number(),
    // NB: NO `userId` arg. Server takes from ctx.auth. Convex's args
    // validator rejects unknown args, so injecting `userId` from
    // DevTools fails at the validator level before this handler runs.
  },
  handler: async (ctx, args) => {
    const { userId, displayName } = await requireUserWithProfile(ctx);

    const battle = await ctx.db.get(args.battleId);
    if (!battle) throw new ConvexError("Battle not found.");

    const now = Date.now();
    if (now >= battle.expiresAt) {
      throw new ConvexError("This battle has expired.");
    }

    // Rate limit: same user submitting to same battle within 10s.
    // Operational hygiene — NOT cheat prevention. Catches double-clicks
    // and retry loops, not malicious throughput.
    const lastAttempt = await ctx.db
      .query("battleAttempts")
      .withIndex("by_battle_user", (q) =>
        q.eq("battleId", args.battleId).eq("userId", userId),
      )
      .order("desc")
      .first();
    if (lastAttempt && now - lastAttempt.submittedAt < RATE_LIMIT_MS) {
      throw new ConvexError(
        "You're submitting too fast. Please wait a few seconds.",
      );
    }

    // Max-participants check: count distinct userIds with attempts in
    // this battle. New userId + count >= cap → reject. Existing
    // participants can keep submitting (their userId is already counted).
    if (!lastAttempt) {
      const allAttempts = await ctx.db
        .query("battleAttempts")
        .withIndex("by_battleId", (q) => q.eq("battleId", args.battleId))
        .collect();
      const distinctParticipants = new Set(allAttempts.map((a) => a.userId));
      if (distinctParticipants.size >= battle.maxParticipants) {
        throw new ConvexError(
          `This battle is full (${battle.maxParticipants} participants).`,
        );
      }
    }

    // Bounds + internal-consistency. Bypassable in principle (a crafted
    // submission with consistent fake numbers passes) but catches edit-
    // one-not-the-other tampering and out-of-range garbage.
    const validationError = validateAttemptResultInline({
      startingBalance: battle.startingBalance,
      finalBalance: args.finalBalance,
      pnlPct: args.pnlPct,
      trades: args.trades,
      winRate: args.winRate,
    });
    if (validationError) throw new ConvexError(validationError);

    // Rule-vs-result consistency: if the battle has a maxDrawdownPct
    // and the submitted final P&L is below that threshold, the attempt
    // MUST have hit max drawdown — disqualified=false in that case is
    // internally inconsistent and indicates tampering. We can't catch
    // intra-session breaches without per-bar equity history (deferred
    // to v2.x replay log), but the final-balance check is free.
    // Stored as ratio (0.05 = 5%) per the Battle type; converted to
    // percent (negative threshold) for comparison against pnlPct.
    if (
      battle.rules.maxDrawdownPct !== undefined &&
      !args.disqualified
    ) {
      const drawdownPctThreshold = -battle.rules.maxDrawdownPct * 100;
      if (args.pnlPct < drawdownPctThreshold) {
        throw new ConvexError(
          "Inconsistent submission: final P&L is past the max-drawdown threshold but the attempt is not marked disqualified.",
        );
      }
    }

    await ctx.db.insert("battleAttempts", {
      battleId: args.battleId,
      userId,
      displayNameSnapshot: displayName,
      finalBalance: args.finalBalance,
      pnlPct: args.pnlPct,
      trades: args.trades,
      winRate: args.winRate,
      disqualified: args.disqualified,
      disqualificationReason: args.disqualificationReason,
      completedAt: args.completedAt,
      submittedAt: now,
    });
  },
});

// =============================================================
// Queries
// =============================================================

// Lobby queries return battles JOINED with their attempts to save the
// client an N+1 round-trip. At 5-friends scale this is cheap; revisit
// if a single battle accumulates hundreds of attempts.

export const listPublicBattles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const battles = await ctx.db
      .query("battles")
      .withIndex("by_visibility", (q) => q.eq("visibility", "public"))
      .order("desc")
      .collect();
    return Promise.all(
      battles.map(async (battle) => ({
        battle,
        attempts: await ctx.db
          .query("battleAttempts")
          .withIndex("by_battleId", (q) => q.eq("battleId", battle._id))
          .collect(),
      })),
    );
  },
});

export const listMyBattles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const battles = await ctx.db
      .query("battles")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .order("desc")
      .collect();
    return Promise.all(
      battles.map(async (battle) => ({
        battle,
        attempts: await ctx.db
          .query("battleAttempts")
          .withIndex("by_battleId", (q) => q.eq("battleId", battle._id))
          .collect(),
      })),
    );
  },
});

export const getBattle = query({
  args: { battleId: v.id("battles") },
  handler: async (ctx, { battleId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(battleId);
  },
});

export const getBattleByInviteCode = query({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const battle = await ctx.db
      .query("battles")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
      .unique();
    if (!battle) return null;
    if (Date.now() >= battle.expiresAt) return null;
    return battle;
  },
});

export const listAttempts = query({
  args: { battleId: v.id("battles") },
  handler: async (ctx, { battleId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("battleAttempts")
      .withIndex("by_battle_completed", (q) => q.eq("battleId", battleId))
      .order("desc")
      .collect();
  },
});
