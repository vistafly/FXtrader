"use client";

import Link from "next/link";
import { useState } from "react";

import { NewSessionDialog } from "@/components/trade/NewSessionDialog";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Phase 5 — trading flow
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">FXTrader</h1>
        <p className="text-base text-muted-foreground">
          Rewind the markets. Sharpen your edge.
        </p>
      </header>

      <section className="grid gap-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        <p className="text-foreground">Foundation in place:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Replay engine + matching engine + 52 unit tests</li>
          <li>UDF-shaped DataProvider with synthetic + real (Dukascopy / Yahoo) sources</li>
          <li>Lightweight Charts wrapper · OHLC tooltip · timeline scrubber</li>
          <li>Session creation · order entry · live P&L · IndexedDB persistence</li>
        </ul>
        <div className="flex items-center gap-3 pt-3">
          <Button onClick={() => setNewSessionOpen(true)}>Start new session</Button>
          <Button asChild variant="ghost">
            <Link href="/trade/demo">Phase 4 demo (no session)</Link>
          </Button>
        </div>
      </section>

      <NewSessionDialog open={newSessionOpen} onOpenChange={setNewSessionOpen} />
    </main>
  );
}
