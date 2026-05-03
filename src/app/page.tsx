// Public landing page (anonymous-accessible, gated by middleware to be
// the only authed-app-adjacent page anyone without a session sees).
//
// Architecture per CLAUDE.md §16.1:
//   - / → landing (this file)
//   - /dashboard → authed app (formerly /, moved in v2.1.5)
//   - /signin, /signup → auth pages
//   - everything else → middleware-gated
//
// Authed users hitting / still see the landing — that's intentional, no
// auto-redirect. Lets returning users browse marketing without forced
// dashboard-takeover. Their UserMenu in the authed app has the entry
// point; the landing has discovery CTAs for new visitors.
import { Hero } from "@/components/landing/Hero";
import { LandingNav } from "@/components/landing/LandingNav";
import { ProductShowcase } from "@/components/landing/ProductShowcase";

export default function LandingPage() {
  return (
    <>
      <LandingNav />
      <Hero />
      <ProductShowcase />
      <footer className="border-t border-border/60 px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono uppercase tracking-wider">
            FXTrader — practice replay simulator
          </span>
          <span className="font-mono">v2</span>
        </div>
      </footer>
    </>
  );
}
