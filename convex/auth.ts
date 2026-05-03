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
//    of work for a non-problem at this scale. Add a reset flow as part of
//    "v2.x: public lobbies" when public signups make this load-bearing.
//
//    See CLAUDE.md §16.1 (v2 scope expansion) for the broader scope cuts.
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
