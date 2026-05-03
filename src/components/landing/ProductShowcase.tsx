// Below-hero product visual block.
//
// Renders public/screenshot-trade.png at ~1100px wide with a soft glow and
// a subtle border. The image's job is to show the product looks expensive
// without writing more copy. If the screenshot is missing on disk, Next.js
// Image will throw at build time — that's fine, it's a hard dependency
// per the v2.1.5 plan (option α).
import Image from "next/image";

export function ProductShowcase() {
  return (
    <section className="relative px-6 pb-24">
      <div className="mx-auto max-w-6xl">
        <div className="relative">
          {/* Glow halo behind the image — same primary tint as the hero
              radial. Slightly offset so the image floats over it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-12 rounded-3xl bg-primary/10 blur-3xl"
          />
          <div className="relative overflow-hidden rounded-xl border border-border/80 shadow-2xl">
            <Image
              src="/screenshot-trade.png"
              alt="FXTrader trade view: EURUSD chart with an open position, take-profit and stop-loss lines, and live unrealized P&L."
              width={2560}
              height={1440}
              priority
              className="h-auto w-full"
              sizes="(min-width: 1280px) 1100px, (min-width: 768px) 90vw, 100vw"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
