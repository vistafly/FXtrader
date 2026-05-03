// Convex HTTP routes.
//
// @convex-dev/auth requires HTTP routes for session/cookie handling. This is
// the minimum required wiring; do not add other HTTP routes here unless the
// app actually serves an HTTP API beyond auth (it doesn't, in v2).
import { httpRouter } from "convex/server";

import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
