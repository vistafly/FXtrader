"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { useEffect } from "react";
import { Toaster, toast } from "sonner";

import { processBar } from "@/lib/engine/MatchingEngine";
import { getInstrument } from "@/lib/instruments/instruments";
import type { ReplayEngine } from "@/lib/engine/ReplayEngine";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Module-scope singleton so HMR doesn't churn through clients.
const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
);

/**
 * Root client provider. Owns the engine ↔ store wiring per CLAUDE.md §9 + Phase 5 D1.
 *
 * v2.2.5α changes:
 * - Subscribe to EVERY engine in the masterClock (not a single engine).
 * - On each engine's bar event, run processBar with ONLY that instrument's
 *   pending orders + open positions. This preserves the per-instrument
 *   independence required for multi-asset battles: an EURUSD bar event
 *   doesn't touch NQ!'s pending orders.
 * - Re-wire on every engines map change (initEnginesMulti / dispose).
 *
 * Critical ordering guarantee:
 *   On each engine `bar` event, MatchingEngine.processBar runs FIRST and
 *   orderStore + sessionStore are updated BEFORE the chart's own
 *   subscriber paints. ReplayEngine emits to subscribers in insertion order;
 *   this hook attaches at app-root mount, while ChartContainer attaches
 *   later when its component mounts. So fills appear in the position table
 *   in the same frame the bar paints, not a frame late.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    /**
     * Per-engine subscriptions. Map stores symbol → unsubscribe so we can
     * cleanly tear down when the engines map changes (e.g. dispose, swap to
     * a different battle's instrument set).
     */
    const engineSubs = new Map<string, () => void>();

    /**
     * v2.2.5α: track which session-ids have already had their drawdown DQ
     * handled. In multi-engine mode every engine's bar event independently
     * computes drawdownViolation against the cross-instrument equity total,
     * so a single threshold breach fires the DQ handler once per engine
     * per master tick (5x for a 5-instrument battle). Without this guard
     * the user gets N toasts AND N concurrent endSession calls — the latter
     * spam Convex's submitAttempt rate limiter.
     */
    const dqHandledSessions = new Set<string>();

    const wireEngine = (symbol: string, engine: ReplayEngine) => {
      // Track last forward index to skip backward-scrub events.
      let lastProcessedIndex = -1;
      const unsub = engine.subscribe((event) => {
        if (event.type !== "bar") return;
        const goingForward = event.index > lastProcessedIndex;
        lastProcessedIndex = event.index;
        if (!goingForward) return;

        const session = useSessionStore.getState().activeSession;
        if (!session) return;

        const instrument = getInstrument(symbol);
        const orderState = useOrderStore.getState();
        const sessionState = useSessionStore.getState();

        // Filter the order/position lists to THIS instrument only.
        const myPending = orderState.pendingOrders.filter(
          (o) => o.instrument === symbol,
        );
        const myOpen = orderState.openPositions.filter(
          (p) => p.instrument === symbol,
        );

        const result = processBar({
          bar: event.bar,
          pendingOrders: myPending,
          openPositions: myOpen,
          instrument,
          equityCheck: { balance: sessionState.balance },
        });

        const { closuresApplied } = orderState.applyBarResult(
          result,
          event.bar,
          instrument,
        );

        // For settlement: pass ALL still-open positions (across all
        // instruments) so cross-instrument margin aggregation works.
        const openAfter = useOrderStore.getState().openPositions;
        const settle = useSessionStore.getState().applyBarSettlement({
          closures: closuresApplied,
          openPositions: openAfter,
          currentPrice: event.bar.close,
          currentBarTime: event.bar.time,
          // Per-instrument-event hint: which instrument's bar triggered this
          // settlement pass. Used for instrument-specific bookkeeping if any.
          instrumentSymbol: symbol,
        });

        // Phase 7 D5: battle drawdown auto-fail. Hard end + DQ + pause +
        // toast — a single coordinated response. Multi-asset note:
        // drawdown is computed on TOTAL equity (cross-instrument), so any
        // engine's bar tick can trigger the violation.
        if (settle.drawdownViolation) {
          // Idempotency guard: only the FIRST engine to detect the breach
          // for this session does the DQ chain. Subsequent fires (from other
          // engines on the same master tick, or from this engine on later
          // ticks before endSession's async write completes) bail out here.
          if (dqHandledSessions.has(session.id)) return;
          dqHandledSessions.add(session.id);

          const clock = useReplayStore.getState().masterClock;
          if (clock) clock.pause();
          else useReplayStore.getState().pause();

          // v2.2.5α: force-close every open position at its instrument's
          // current bar close. Without this the user sees a frozen replay
          // with positions still "open" forever — and worse, could place
          // new orders if any UI surface dodged the session.status guard.
          // Realized P&L from these closures settles into balance below
          // before endSession computes the final attempt.
          const { realizedDelta, trades: forced } = useOrderStore
            .getState()
            .forceCloseAllPositions("liquidated");
          if (realizedDelta !== 0 || forced.length > 0) {
            const eq = useSessionStore.getState().applyBarSettlement({
              closures: forced.map((t) => ({ realizedPnl: t.pnl, trade: t })),
              openPositions: [],
              currentPrice: event.bar.close,
              currentBarTime: event.bar.time,
              instrumentSymbol: symbol,
            });
            void eq;
          }

          toast.error(`Attempt disqualified: ${settle.drawdownViolation}`);
          void useSessionStore.getState().endSession({
            disqualified: true,
            reason: settle.drawdownViolation,
            submitToServer: async (data) => {
              await convex.mutation(api.battles.submitAttempt, {
                battleId: data.battleId as Id<"battles">,
                finalBalance: data.finalBalance,
                pnlPct: data.pnlPct,
                trades: data.trades,
                winRate: data.winRate,
                disqualified: data.disqualified,
                disqualificationReason: data.disqualificationReason,
                completedAt: data.completedAt,
              });
            },
          });
        }
      });
      engineSubs.set(symbol, unsub);
    };

    const teardownAll = () => {
      for (const [, unsub] of engineSubs) unsub();
      engineSubs.clear();
    };

    const wireAll = (engines: Map<string, ReplayEngine>) => {
      teardownAll();
      for (const [symbol, engine] of engines) wireEngine(symbol, engine);
    };

    // Wire whatever engines are currently in the store.
    wireAll(useReplayStore.getState().engines);

    // Re-wire whenever the engines Map identity changes (initEnginesMulti
    // creates a fresh Map).
    const unsubStore = useReplayStore.subscribe((state, prev) => {
      if (state.engines !== prev.engines) wireAll(state.engines);
    });

    return () => {
      teardownAll();
      unsubStore();
    };
  }, []);

  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
      <Toaster theme="dark" position="top-right" />
    </ConvexAuthNextjsProvider>
  );
}
