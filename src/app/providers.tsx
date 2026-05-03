"use client";

import { useEffect } from "react";
import { Toaster, toast } from "sonner";

import { processBar } from "@/lib/engine/MatchingEngine";
import { getInstrument } from "@/lib/instruments/instruments";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";

/**
 * Root client provider. Owns the engine ↔ store wiring per CLAUDE.md §9 + Phase 5 D1.
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
    let unsubBar: (() => void) | null = null;

    const wireEngine = (engine: ReturnType<typeof useReplayStore.getState>["engine"]) => {
      if (unsubBar) {
        unsubBar();
        unsubBar = null;
      }
      if (!engine) return;

      // Track the last bar index processed. We only run the matching engine
      // on FORWARD movement — scrubbing back through history must not
      // re-evaluate orders/positions, since those are anchored to their
      // submission time. Backward scrubs are pure visual/temporal navigation.
      let lastProcessedIndex = -1;

      unsubBar = engine.subscribe((event) => {
        if (event.type !== "bar") return;

        const goingForward = event.index > lastProcessedIndex;
        lastProcessedIndex = event.index;
        if (!goingForward) return;

        const session = useSessionStore.getState().activeSession;
        if (!session) return;

        const instrument = getInstrument(session.instrument);
        const orderState = useOrderStore.getState();
        const sessionState = useSessionStore.getState();

        const result = processBar({
          bar: event.bar,
          pendingOrders: orderState.pendingOrders,
          openPositions: orderState.openPositions,
          instrument,
          equityCheck: { balance: sessionState.balance },
        });

        const { closuresApplied } = orderState.applyBarResult(
          result,
          event.bar,
          instrument,
        );

        const openAfter = useOrderStore.getState().openPositions;
        const settle = useSessionStore.getState().applyBarSettlement({
          closures: closuresApplied,
          openPositions: openAfter,
          instrument,
          currentPrice: event.bar.close,
          currentBarTime: event.bar.time,
        });

        // Phase 7 D5: battle drawdown auto-fail. Hard end + DQ + pause +
        // toast — a single coordinated response handled by the orchestrator
        // since it owns the engine reference.
        if (settle.drawdownViolation) {
          engine.pause();
          toast.error(`Attempt disqualified: ${settle.drawdownViolation}`);
          // Fire-and-forget the persistence — UI is already updated.
          void useSessionStore.getState().endSession({
            disqualified: true,
            reason: settle.drawdownViolation,
          });
        }
      });
    };

    // Wire whatever engine is currently in the store.
    wireEngine(useReplayStore.getState().engine);

    // Re-wire whenever loadInstrument creates a fresh engine.
    const unsubStore = useReplayStore.subscribe((state, prev) => {
      if (state.engine !== prev.engine) wireEngine(state.engine);
    });

    return () => {
      if (unsubBar) unsubBar();
      unsubStore();
    };
  }, []);

  return (
    <>
      {children}
      <Toaster theme="dark" position="top-right" />
    </>
  );
}
