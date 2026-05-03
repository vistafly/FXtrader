// Public landing page top nav.
//
// Logo left → /, plus a Sign in ghost + Get started primary CTA on the right.
// Stays out of the authed UserMenu flow — landing has no profile state to
// surface, just acquisition CTAs.
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function LandingNav() {
  return (
    <nav className="flex items-center justify-between gap-3 px-6 py-5 sm:px-10">
      <Link
        href="/"
        className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wider"
      >
        <span className="text-primary">FX</span>
        <span>Trader</span>
      </Link>
      <div className="flex items-center gap-1 sm:gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/signin">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/signup">Get started</Link>
        </Button>
      </div>
    </nav>
  );
}
