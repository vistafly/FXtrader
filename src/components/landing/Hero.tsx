// Landing page hero.
//
// Three-line headline, gradient on the first line. Centered. Two CTAs:
// primary "Get started" → /signup, ghost "Sign in" → /signin.
//
// Copy is locked: "Replay any market. / Take any trade. / No money on the
// line." Don't replace with cliche trading taglines without a re-discussion.
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 py-20 sm:py-28">
      {/* Subtle radial glow behind the hero — the "expensive dark" cue
          per DESIGN_SYSTEM. Color from --primary so it tracks theme tokens. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[120px]"
      />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl md:text-6xl">
          <span className="block bg-gradient-to-br from-primary via-primary to-cyan-400 bg-clip-text text-transparent">
            Replay any market.
          </span>
          <span className="block">Take any trade.</span>
          <span className="block text-muted-foreground">
            No money on the line.
          </span>
        </h1>
        <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
          A practice ground for discretionary traders. Bar-by-bar replay,
          simulated trades, your edge sharpened against real history.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <Link href="/signin">Sign in</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
