// Next.js middleware — wires Convex auth session refresh.
//
// v2.1: minimum-viable wiring. Does NOT enforce route protection yet —
// every existing route stays publicly reachable, anonymous v1 flows work
// unchanged. Later phases (v2.2+) will add `createRouteMatcher` checks
// to redirect /battles/server-* etc. to /signin.
import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";

export default convexAuthNextjsMiddleware();

export const config = {
  // Match everything except static files and _next internals.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
