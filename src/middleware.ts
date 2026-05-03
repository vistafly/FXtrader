// Next.js middleware — wires Convex auth session refresh AND enforces the
// v2.1.5 mandatory auth gate.
//
// Public routes (anonymous-accessible):
//   - `/` (landing)
//   - `/signin` and `/signup` (auth pages)
//   - `/api/auth/*` (auth library proxy — internal to @convex-dev/auth)
//   - Static assets (matched-out via the `matcher` config below)
//
// Protected routes (require auth, otherwise redirect to /signin?next=<path>):
//   - everything else, including `/dashboard`, `/battles`, `/journal`,
//     `/trade/[sessionId]`, `/settings`
//
// Redirect mechanic: middleware runs BEFORE Next.js renders the page.
// Anonymous user hitting /dashboard gets a 307 to /signin?next=/dashboard
// without ever rendering /dashboard's HTML — no SSR'd authed content
// flashes for unauthenticated users.
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/signin",
  "/signup",
  "/api/auth(.*)",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isPublicRoute(request)) return;

  const isAuthed = await convexAuth.isAuthenticated();
  if (isAuthed) return;

  // Preserve the original path so /signin can bounce back after success.
  // The path goes through validateNextParam on the way out so we never
  // redirect to anything outside the known authed-route allowlist.
  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return nextjsMiddlewareRedirect(
    request,
    `/signin?next=${encodeURIComponent(next)}`,
  );
});

export const config = {
  // Match everything except static files and _next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
