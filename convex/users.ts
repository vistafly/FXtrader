// Public read queries against the auth `users` table.
//
// Scope discipline: this file holds READ ONLY queries. No write mutations,
// no mass-delete-by-predicate utilities. Mass-delete is reserved for the
// Convex dashboard's manual data viewer at the friends-only scale we run.
//
// Account-enumeration trade-off: `emailExists` lets any caller probe for
// whether a given email is registered. Acceptable at the closed-friends-only
// scale we ship to in v2.0; document in BACKLOG to remove or rate-limit
// before opening to public lobbies.
import { v } from "convex/values";

import { query } from "./_generated/server";

export const emailExists = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const normalized = email.replace(/\s/g, "").toLowerCase();
    if (!normalized) return false;
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", normalized))
      .first();
    return existing !== null;
  },
});
