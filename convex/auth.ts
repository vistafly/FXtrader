// Convex auth — email/password only for v2.0.
//
// Decisions baked in here:
//
// 1. Password provider only (no OAuth). For "5 friends" scale email/password
//    keeps the dependency surface small. Add OAuth providers in v2.x if/when
//    we open to public.
//
// 2. NO password reset / forgot-password flow in v2.0. At friends-only scale
//    the recovery channel is Discord ("text me, I'll reset you"). Wiring up
//    reset emails (provider + transactional mail vendor + UX) is ~half a day
//    of work for a non-problem at this scale.
//
// 3. Profile creation is atomic with user creation via the
//    `afterUserCreatedOrUpdated` callback below. Earlier v2.1 had a race —
//    `await signIn(...)` on the client resolves once the auth cookie is set,
//    but the Convex WebSocket's auth identity refresh is async, so an
//    immediate client-side `createProfile()` mutation saw the OLD (null)
//    identity and threw "Must be signed in". Doing the profile insert
//    server-side, in the same transaction as user creation, eliminates the
//    race entirely.
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { internal } from "./_generated/api";

const DISPLAY_NAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

// Mirror of src/lib/auth/emailNormalize.ts — duplicated here because
// convex/ runs in its own runtime and can't import from src/.
// Kept inline (one-liner) rather than a separate convex/_lib/ file
// because the drift surface is small and the tests on the src/ copy
// document the contract.
function normalizeEmail(input: string): string {
  return input.replace(/\s/g, "").toLowerCase();
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // profile() runs server-side during signIn/signUp. Captures the
      // form's displayName so it survives into afterUserCreatedOrUpdated
      // (via the auth users table's `name` field) without polluting the
      // schema with a transient column.
      profile(params) {
        const email = normalizeEmail(params.email as string);
        const displayName = params.displayName as string | undefined;
        if (params.flow === "signUp") {
          if (!displayName || !DISPLAY_NAME_RE.test(displayName)) {
            throw new ConvexError(
              "Display name must be 3-20 characters: letters, numbers, _ or -",
            );
          }
        }
        return {
          email,
          ...(displayName ? { name: displayName } : {}),
        };
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, args) {
      // Only run on first creation. Updates (e.g. password change) are
      // a no-op — the profile already exists.
      if (args.existingUserId) return;
      const user = await ctx.db.get(args.userId);
      if (!user) return;
      const displayName =
        typeof user.name === "string" ? user.name : undefined;
      if (!displayName || !DISPLAY_NAME_RE.test(displayName)) return;

      // Delegate to an internalMutation in convex/profiles.ts which has
      // typed ctx.db access to our schema's `profiles` indexes. The
      // callback's ctx is generic and only sees auth tables, so doing
      // the insert directly here would fail typecheck.
      await ctx.runMutation(internal.profiles.createProfileForUser, {
        userId: args.userId,
        displayName,
      });
    },
  },
});
