"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { ReplayControls } from "@/components/replay/ReplayControls";
import { ScrubberBar } from "@/components/replay/ScrubberBar";
import { AccountHUD } from "@/components/trade/AccountHUD";
import { AccountSidebar } from "@/components/trade/AccountSidebar";
import { ChartGrid } from "@/components/trade/ChartGrid";
import { ClosedPositionsTable } from "@/components/trade/ClosedPositionsTable";
import { LayoutSelector } from "@/components/trade/LayoutSelector";
import { OpenPositionsTable } from "@/components/trade/OpenPositionsTable";
import { PlaceOrderDialog } from "@/components/trade/PlaceOrderDialog";
import { CountdownTimer } from "@/components/trade/CountdownTimer";
import { QuickBuySellPanel } from "@/components/trade/QuickBuySellPanel";
import { ReadyIntroOverlay } from "@/components/trade/ReadyIntroOverlay";
import { RulesChips } from "@/components/trade/RulesChips";
import { SubmitFinalDialog } from "@/components/trade/SubmitFinalDialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import {
  formatDuration,
  formatMoney,
  formatPercent,
} from "@/lib/analytics/stats";
import { BundledDataProvider } from "@/lib/data/BundledDataProvider";
import {
  attemptEventQueue,
  type AppendEventFn,
} from "@/lib/events/AttemptEventQueue";
import { replayEvents } from "@/lib/events/AttemptReducer";
import type { AttemptEvent } from "@/lib/events/AttemptEvent";
import { sessionRepository } from "@/lib/repository/SessionRepository";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import { useLayoutStore, selectActiveInstrument } from "@/stores/layoutStore";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { OrderSide } from "@/types/order";
import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * v2.2.5α: engines always use 1m source data; per-pane PaneTimeframeSelector
 * drives display via BarAggregator. The master clock's step granularity is
 * 1m regardless of any pane's chosen display timeframe.
 */
const MASTER_TIMEFRAME_MINUTES = 1;
const SOURCE_RESOLUTION = "1";

/**
 * v2.3 sub-phase 2B: convert the reducer's canonical state back into
 * orderStore's runtime shape. The reducer tracks the minimum needed
 * for replay; orderStore carries some live fields (unrealizedPnl,
 * sessionId, status) that get filled in here. The chart re-marks
 * unrealizedPnl on the next bar event, so we initialize it to 0.
 */
function hydrateOrderStoreFromReducer(
  reducerState: import("@/lib/events/AttemptReducer").ReducerState,
  sessionId: string,
): void {
  const openPositions = Object.values(reducerState.openPositions).map(
    (p) => ({
      id: p.id,
      sessionId,
      instrument: p.instrument,
      side: p.side,
      size: p.size,
      entryPrice: p.entryPrice,
      entryTime: p.entryTime,
      takeProfit: p.takeProfit,
      stopLoss: p.stopLoss,
      unrealizedPnl: 0,
      realizedPnl: 0,
      commission: 0,
      status: "open" as const,
    }),
  );
  const pendingOrders = Object.values(reducerState.pendingOrders).map(
    (o) => ({
      id: o.id,
      sessionId,
      instrument: o.instrument,
      side: o.side,
      type: o.type,
      size: o.size,
      limitPrice: o.limitPrice,
      stopPrice: o.stopPrice,
      takeProfit: o.takeProfit,
      stopLoss: o.stopLoss,
      status: "pending" as const,
      createdAt: 0,
    }),
  );
  // closedTrades from the reducer carry the canonical record; map to
  // the Trade shape orderStore + tradeRepository expect.
  const closedTrades = reducerState.closedTrades.map((t) => ({
    id: `replay-${t.positionId}`,
    sessionId,
    instrument: t.instrument,
    side: t.side,
    size: t.size,
    entryPrice: t.entryPrice,
    entryTime: t.entryTime,
    exitPrice: t.closePrice,
    exitTime: t.closeTime,
    // orderStore Trade.pnl is NET; reducer realizedPnl is GROSS.
    pnl: t.realizedPnl - t.commission,
    pips: 0, // recomputed lazily if a UI reads it; not used by reducer math
    commission: t.commission,
    duration: t.closeTime - t.entryTime,
    closeReason: t.closeReason,
  }));
  // We intentionally OVERWRITE existing state (Dexie's restoration)
  // with the Convex-canonical replay. Single-player / local-battle
  // sessions skip this code path entirely.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useOrderStore } = require("@/stores/orderStore") as typeof import("@/stores/orderStore");
  useOrderStore.setState({
    openPositions,
    pendingOrders,
    closedTrades,
  });
}

export default function TradeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();

  const [bootError, setBootError] = useState<string | null>(null);
  const [bootedFor, setBootedFor] = useState<string | null>(null);
  const [dialogSide, setDialogSide] = useState<OrderSide | null>(null);
  // v2.2.5α: when the loaded session has status "ended" (user closed it OR
  // liquidated mid-replay), short-circuit boot and render a session-ended
  // screen instead of the trade UI. Optional reason — only fetched for
  // local sessions in 5α; server-attempt reasons land in v2.3 alongside the
  // resumable / watch-on-liquidation work.
  const [endedReason, setEndedReason] = useState<{
    ended: boolean;
    reason?: string;
  } | null>(null);

  // Right sidebar visibility (collapsible).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tableHeight, setTableHeight] = useState(192);

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = tableHeight;
    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(0, Math.min(window.innerHeight * 0.6, startHeight + delta));
      setTableHeight(next);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "ns-resize";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const session = useSessionStore((s) => s.activeSession);
  // v2.3 sub-phase 3: live battle reference for the countdown's
  // duration source. activeBattle is set by startSession from the
  // params; battleSnapshot is the persisted fallback for reload.
  const activeBattle = useSessionStore((s) => s.activeBattle);
  // v2.3 sub-phase 3 (revised): wall-clock countdown needs the
  // server-side `startedAt` (set when the host clicks Start match)
  // plus durationMinutes. Live useQuery so the countdown reacts
  // when a creator starts the match while the joiner is on /trade.
  const liveBattle = useQuery(
    api.battles.getBattle,
    session?.battleSource === "server" && session?.battleId
      ? { battleId: session.battleId as Id<"battles"> }
      : "skip",
  );
  // v2.2.5α: the focused pane's instrument drives order routing + the
  // QuickBuySellPanel symbol prop. Falls back to session.instrument before
  // the layoutStore is initialized (boot has not completed yet).
  const activePaneInstrument = useLayoutStore(selectActiveInstrument);

  // v2.3 sub-phase 2B: hooks declared early so the boot useEffect can
  // capture them in its closure without tripping the
  // react-hooks/immutability TDZ check.
  const submitServerAttempt = useMutation(api.battles.submitAttempt);
  const appendEventMut = useMutation(api.attempts.appendEvent);
  const markCompletedMut = useMutation(api.attempts.markCompleted);
  const convex = useConvex();

  // v2.3 sub-phase 3: Ready intro state declared early so the boot
  // useEffect (which sets it on empty-log first entry) doesn't
  // access a not-yet-declared setter.
  const [showReadyIntro, setShowReadyIntro] = useState(false);

  // Boot the session: load from Dexie, fetch bars (one or many), seed the
  // engines via MasterClock, hardcode-init the layout from instruments.
  // v2.3 sub-phase 2B: when session.attemptId is set (server-battle path),
  // also fetch the Convex event log + replay through AttemptReducer to
  // restore canonical state, then initialize the AttemptEventQueue with
  // the attempt's lastEventSeq so subsequent enqueues append at the
  // correct position. Dexie's per-2s persistence remains the
  // same-browser fast path; Convex is the cross-browser source of truth.
  useEffect(() => {
    let cancelled = false;
    const key = `${sessionId}/${SOURCE_RESOLUTION}`;

    async function boot() {
      try {
        let active = useSessionStore.getState().activeSession;
        if (!active || active.id !== sessionId) {
          await useSessionStore.getState().loadSession(sessionId);
          active = useSessionStore.getState().activeSession;
          useOrderStore.getState().resetForSession();
          const trades = await tradeRepository.listForSession(sessionId);
          if (trades.length > 0) {
            useOrderStore.setState({ closedTrades: trades });
          }
          // v2.2.5α: restore open positions + pending orders from the
          // session row. Without this, reload erases everything mid-attempt
          // and the user can dodge a drawdown breach by reloading. The
          // session row is the source of truth — saved periodically by the
          // persistence interval below.
          if (active) {
            const restoredOpen = (active.openPositions ?? []) as ReturnType<
              typeof useOrderStore.getState
            >["openPositions"];
            const restoredPending = (active.pendingOrders ?? []) as ReturnType<
              typeof useOrderStore.getState
            >["pendingOrders"];
            if (restoredOpen.length > 0 || restoredPending.length > 0) {
              useOrderStore.setState({
                openPositions: restoredOpen,
                pendingOrders: restoredPending,
              });
            }
          }
        }
        if (cancelled || !active) return;

        // v2.2.5α: when the session is already ended on boot, still load the
        // engines so the chart renders behind the SessionEndedOverlay (gives
        // the user visual context — they can see the price action that
        // liquidated them). Look up the disqualification reason for local
        // attempts; server-attempt reasons land in v2.3.
        if (active.status === "ended") {
          let reason: string | undefined;
          if (active.battleId && active.battleSource !== "server") {
            const { battleRepository } = await import(
              "@/lib/repository/BattleRepository"
            );
            const attempts = await battleRepository.listAttempts(active.battleId);
            const mine = attempts.find((a) => a.sessionId === sessionId);
            reason = mine?.disqualificationReason;
          }
          if (!cancelled) setEndedReason({ ended: true, reason });
          // Fall through — boot engines + chart so the overlay has a
          // blurred backdrop showing the relevant price action.
        }

        const provider = new BundledDataProvider({ baseUrl: "/data" });

        // v2.2.5α: choose between single- and multi-instrument boot. Sessions
        // that come from a multi-asset battle carry instruments[]; otherwise
        // we treat them as legacy single-instrument.
        const instruments =
          active.instruments && active.instruments.length > 0
            ? active.instruments
            : [active.instrument];

        if (instruments.length > 1) {
          await useReplayStore
            .getState()
            .loadInstrumentsMulti(
              provider,
              instruments,
              active.startBarTime,
              SOURCE_RESOLUTION,
            );
        } else {
          await useReplayStore
            .getState()
            .loadInstrument(provider, instruments[0], SOURCE_RESOLUTION);
        }

        // v2.2.5α: resume the master clock at session.currentBarTime when it
        // has advanced past startBarTime. Without this, reload would reset
        // the engine to the start, replay through already-traded bars, and
        // could re-trigger drawdown breaches as if the user had dodged the
        // limit. session.currentBarTime is updated by applyBarSettlement on
        // every tick and persisted by the interval below.
        if (
          active.currentBarTime &&
          active.currentBarTime > active.startBarTime
        ) {
          useReplayStore.getState().seek(active.currentBarTime);
        }

        // Initialize the layout store from instruments + persisted state (if any).
        useLayoutStore
          .getState()
          .initFromInstruments(instruments, active.layoutState);

        // v2.3 sub-phase 2B: hydrate from the Convex event log when the
        // session is bound to a server attempt. Replay all events
        // through the pure reducer to derive canonical state, then
        // overwrite orderStore + balance with the result. The Dexie
        // restoration above already painted the chart instantly; this
        // reconciles against the server's source of truth.
        //
        // Skip the entire event-log path when the session is already
        // ended — appendEvent would reject every queued event with
        // "attempt-not-in-flight", spamming console errors. Ended
        // sessions are read-only; the chart still renders for
        // post-mortem viewing (D9 watch-mode).
        if (active.attemptId && active.status !== "ended") {
          // v2.3 sub-phase 3 (D8): read the fresh-attempt flag set by
          // the battle page's onNewAttempt. ONLY a flag match shows
          // the Ready intro — resumes / rejoins / cross-tab
          // navigation never have this flag and skip the intro.
          //
          // Do NOT clear here. React StrictMode (dev) double-mounts
          // this effect; clearing eagerly means the second mount
          // sees an empty flag and the overlay never fires. The
          // overlay's onDone callback clears it once the 3-2-1
          // sequence has actually played.
          let isFreshAttempt = false;
          if (typeof window !== "undefined") {
            const flag = sessionStorage.getItem("fx.freshAttempt");
            if (flag === active.attemptId) {
              isFreshAttempt = true;
            }
          }
          // v2.3 sub-phase 3: show the Ready intro IMMEDIATELY when
          // we know it's a fresh attempt — before any await. The
          // overlay is full-screen z-100, so it covers the boot
          // loading state (chart spinner, etc) and the user sees
          // a continuous "click → 3-2-1 → trade UI" experience
          // instead of a brief boot flash before the intro.
          if (isFreshAttempt && !cancelled) {
            setShowReadyIntro(true);
          }

          try {
            const events = (await convex.query(api.attempts.listEvents, {
              attemptId: active.attemptId as Id<"battleAttempts">,
            })) as Array<{
              seq: number;
              type: string;
              payload: AttemptEvent;
              time: number;
            }>;
            const sorted = [...events].sort((a, b) => a.seq - b.seq);
            if (sorted.length > 0) {
              // The payload field carries the full event (we stored
              // the entire event as `payload` in appendEvent). Replay
              // through the reducer to derive canonical state.
              const replayPayloads = sorted.map((e) => e.payload);
              const reducerState = replayEvents(replayPayloads);
              hydrateOrderStoreFromReducer(reducerState, sessionId);
              useSessionStore.setState({ balance: reducerState.balance });
            }
            // Initialize queue at the next-seq the server expects.
            // Idempotent for same attemptId — preserves pending events.
            attemptEventQueue.initialize(
              active.attemptId,
              sorted.length === 0 ? -1 : sorted[sorted.length - 1].seq,
            );
            // v2.3 sub-phase 2B: brand-new attempt has an empty log.
            // The reducer requires `start` as the first event, so
            // enqueue it now from session.battleSnapshot. Subsequent
            // user actions will append seq 1, 2, … via orderStore.
            //
            // Idempotency guard against React StrictMode / HMR double-
            // boot: only enqueue start when the queue's nextSeq is
            // still 0 (truly fresh). If a prior boot run already
            // enqueued start, nextSeq is 1+, and we'd otherwise
            // enqueue a SECOND start which the reducer would later
            // reject with "Duplicate 'start' event at seq 1" on
            // resume replay. Race scenario: run 1 enqueues seq 0
            // (still flushing); run 2 fetches events=[] because
            // run 1's flush hasn't landed; without this guard, run 2
            // would enqueue seq 1 as a second start.
            if (
              sorted.length === 0 &&
              attemptEventQueue.getState().nextSeq === 0
            ) {
              const snap = active.battleSnapshot as
                | {
                    rules?: {
                      maxDrawdownPct?: number;
                      maxLossPerTradePct?: number;
                      requireStopLoss?: boolean;
                      profitTargetPct?: number;
                    };
                  }
                | undefined;
              attemptEventQueue.enqueue({
                type: "start",
                time: active.startBarTime,
                startingBalance: active.startingBalance,
                battleId: active.battleId ?? "",
                instruments,
                rules: snap?.rules ?? {},
              });
            }

          } catch (e) {
            // Convex unavailable / auth issue — fall back to Dexie-only
            // mode. The user can still trade; events just won't sync
            // until the queue is bound on a successful boot.
            console.warn(
              "Failed to hydrate from Convex event log; using Dexie state",
              e,
            );
          }
        }

        if (!cancelled) setBootedFor(key);
      } catch (err) {
        if (!cancelled) setBootError((err as Error).message);
      }
    }

    boot();

    return () => {
      cancelled = true;
      // Halt playback when navigating away. Don't end the session — user may return.
      useReplayStore.getState().pause();
      // v2.2.5α: tear down all engines + the master clock to prevent leaks
      // across session boundaries. The store re-initializes on the next boot.
      useReplayStore.getState().dispose();
      useLayoutStore.getState().reset();
    };
  }, [sessionId, convex]);

  const symbol = activePaneInstrument ?? session?.instrument ?? "";

  // v2.2.5α: persist live session state to Dexie on a 2s interval —
  // open positions, pending orders, layout state, current bar time, and
  // the running balance. Restored on next boot of this session id. Skip
  // ended sessions (their final state is already on the BattleAttempt row
  // via endSession).
  useEffect(() => {
    const interval = setInterval(() => {
      const active = useSessionStore.getState().activeSession;
      if (!active || active.id !== sessionId) return;
      if (active.status !== "active") return;
      const orderState = useOrderStore.getState();
      const layoutState = useLayoutStore.getState().toLayoutState();
      void sessionRepository.put({
        ...active,
        openPositions: orderState.openPositions,
        pendingOrders: orderState.pendingOrders,
        layoutState,
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // U3: when the user changes pane focus, close any open Place Order dialog.
  // The dialog defaults its symbol to the active pane's instrument; closing
  // it on focus change prevents an accidental submit against the now-stale
  // pane. Subscribe to the Zustand store directly (not via the React hook)
  // so the setState call happens outside React's render cycle and doesn't
  // trip the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    const unsub = useLayoutStore.subscribe((state, prev) => {
      if (state.focusEpoch !== prev.focusEpoch) {
        setDialogSide((d) => (d !== null ? null : d));
      }
    });
    return () => unsub();
  }, []);

  useKeyboardShortcuts({
    onOpenBuy: () => setDialogSide("buy"),
    onOpenSell: () => setDialogSide("sell"),
    symbol,
  });

  // v2.3 sub-phase 2B: bind the AttemptEventQueue's appendEvent
  // mutation to the live Convex client. The queue then flushes
  // enqueued events through this binding. setAppendMutation is
  // safe to call repeatedly — the queue swallows null on unmount
  // so an in-flight retry doesn't try to write through a stale
  // mutation reference.
  useEffect(() => {
    const fn: AppendEventFn = async (args) => {
      await appendEventMut({
        attemptId: args.attemptId as Id<"battleAttempts">,
        seq: args.seq,
        type: args.type,
        payload: args.payload,
        time: args.time,
      });
    };
    attemptEventQueue.setAppendMutation(fn);
    return () => attemptEventQueue.setAppendMutation(null);
  }, [appendEventMut]);

  /**
   * v2.3: non-destructive Exit. Pause the replay, flush any
   * pending events to Convex, and navigate to the dashboard. The
   * Session row stays `status: "active"` and the Convex attempt
   * stays `status: "in-flight"` — re-entering /trade/[sessionId]
   * picks up where we left off.
   */
  const onExit = async () => {
    useReplayStore.getState().pause();
    // Best-effort drain. If a transient error makes the flush stall,
    // events will retry next time the queue is initialized — the
    // unflushed buffer is in-memory only at v2.3.
    await attemptEventQueue.flush();
    router.push("/dashboard");
  };

  /**
   * v2.3: destructive Submit Final. Compute final stats, enqueue a
   * `submit-final` event, drain the queue, then call markCompleted
   * server-side and the existing endSession path (which writes the
   * BattleAttempt row + flips the session to `status: "ended"`).
   */
  const onSubmitFinal = async () => {
    const session = useSessionStore.getState().activeSession;
    const balance = useSessionStore.getState().balance;
    if (!session) return;

    // Compute final stats from orderStore's closed trades for this session.
    const allClosed = useOrderStore.getState().closedTrades;
    const sessionTrades = allClosed.filter((t) => t.sessionId === session.id);
    const wins = sessionTrades.filter((t) => t.pnl > 0).length;
    const winRate = sessionTrades.length > 0 ? (wins / sessionTrades.length) * 100 : 0;
    const pnlPct =
      session.startingBalance > 0
        ? ((balance - session.startingBalance) / session.startingBalance) * 100
        : 0;
    const completedAt =
      useReplayStore.getState().currentBarTime || Math.floor(Date.now() / 1000);

    // Enqueue submit-final event before draining so the server log
    // ends with the canonical finalize event. Pause first so no
    // further bar-tick events come after.
    useReplayStore.getState().pause();
    attemptEventQueue.enqueue({
      type: "submit-final",
      time: completedAt,
      finalBalance: balance,
      pnlPct,
      trades: sessionTrades.length,
      winRate,
    });
    await attemptEventQueue.flush();

    // Mark completed server-side (Convex). Only if this session has a
    // bound attemptId (server-battle path).
    if (session.attemptId) {
      try {
        await markCompletedMut({
          attemptId: session.attemptId as Id<"battleAttempts">,
          finalBalance: balance,
          pnlPct,
          trades: sessionTrades.length,
          winRate,
          disqualified: false,
          completedAt,
        });
      } catch (e) {
        toast.error(
          `Failed to lock attempt server-side: ${(e as Error).message}`,
        );
        // Don't return — still call endSession so the local state
        // matches the user's intent. The discrepancy can be reconciled
        // on next boot via the event log.
      }
    }

    // Continue with the existing endSession path (flips session.status
    // to "ended", triggers SessionEndedOverlay, writes the closed
    // BattleAttempt to Dexie for local-history viewing).
    //
    // v2.3: when session.attemptId is set, markCompleted above already
    // finalized the server-side leaderboard row by patching the
    // in-flight battleAttempts entry — calling submitAttempt as well
    // would INSERT a second row (duplicate leaderboard entry) AND
    // trip the 10s rate limiter. Skip the legacy submitToServer path
    // for v2.3 server attempts; keep it for local-only / non-attempt
    // sessions where markCompleted didn't run.
    await useSessionStore.getState().endSession({
      submitToServer: session.attemptId
        ? undefined
        : async (data) => {
            await submitServerAttempt({
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
    toast.success("Attempt submitted.");
    router.push("/dashboard");
  };

  const [submitFinalOpen, setSubmitFinalOpen] = useState(false);
  // Auto-fire Submit Final when the replay-clock countdown reaches
  // zero. Per D7 the countdown is replay-time anchored, so this
  // fires exactly when the master clock has played through the full
  // battle window. Per D9 it keeps advancing in
  // watch-on-after-liquidation mode — the auto-fire is debounced
  // by session.status === "ended" (already-finalized attempts skip).
  const onCountdownExpire = () => {
    const session = useSessionStore.getState().activeSession;
    if (!session || session.status === "ended") return;
    if (!session.attemptId) return; // single-player / local — no submit-final concept
    void onSubmitFinal();
  };

  const loading = bootedFor !== `${sessionId}/${SOURCE_RESOLUTION}` && !bootError;

  // v2.2.5α: when the session is ended (boot OR live DQ), the chart still
  // renders normally below; we layer a blurred overlay on top with the
  // disqualification reason + exit options. Order entry is blocked by
  // orderStore.submitOrder's session.status guard, so the chart-area
  // interactions in the background are read-only-ish.
  const showEndedOverlay = !!(endedReason?.ended || session?.status === "ended");

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">FXTrader</h1>
          {session && (
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {session.name} ·{" "}
              {session.instruments && session.instruments.length > 1
                ? session.instruments.join(" / ")
                : session.instrument}
            </span>
          )}
          {/* v2.3 sub-phase 2B: rules from the active battle, shown
              inline so joiners (and creators) can see the constraints
              they're trading under without leaving the trade view.
              Renders nothing for single-player sessions or when no
              rules are configured. */}
          <RulesChips
            rules={
              (session?.battleSnapshot as
                | { rules?: import("@/types/battle").Battle["rules"] }
                | undefined)?.rules
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {/* v2.3 sub-phase 3 (D7): replay-clock countdown for
              server-battle attempts. Anchored to startBarTime +
              durationMinutes; freezes when the master clock is
              paused. Auto-fires Submit Final at zero.
              Boot-gate: only mount when boot has completed for THIS
              sessionId AND activeSession.id matches. Otherwise the
              CountdownTimer can briefly render with stale session
              data from a previous attempt — if that prior session's
              currentBarTime was past endsAtSec, it would fire onExpire
              against the new session, marking it ended before the
              user has done anything. */}
          {!loading &&
            session?.id === sessionId &&
            session?.attemptId &&
            (() => {
              const snap = session.battleSnapshot as
                | { durationMinutes?: number }
                | undefined;
              const duration =
                liveBattle?.durationMinutes ??
                activeBattle?.durationMinutes ??
                snap?.durationMinutes;
              const startAnchorMs =
                liveBattle?.startedAt ?? session.createdAt * 1000;
              if (!duration || !startAnchorMs) return null;
              return (
                <CountdownTimer
                  endsAtMs={startAnchorMs + duration * 60 * 1000}
                  onExpire={onCountdownExpire}
                  disableExpire={session.status === "ended"}
                />
              );
            })()}
          {/* v2.2.5α: layout selector — only meaningful for multi-asset
              sessions. Single-instrument sessions hide it since 1-pane is
              the only valid choice anyway. */}
          {session?.instruments && session.instruments.length > 1 && (
            <LayoutSelector />
          )}
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex-1 min-h-0 bg-background">
            {loading && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-muted-foreground shadow">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  Loading {symbol || "session"}…
                </div>
              </div>
            )}
            {bootError && (
              <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-destructive">
                {bootError}
              </div>
            )}
            {bootedFor && <ChartGrid />}

            {!sidebarOpen && <AccountHUD />}
            {/* v2.2.5α: per-pane timeframe selector lives inside each
                ChartPane (bottom-center). The previously-global overlay is
                gone — engines always run at 1m source resolution; per-pane
                aggregation handles display. */}
          </div>

          {symbol && (
            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card/50 px-4 py-2">
              <QuickBuySellPanel symbol={symbol} />
              <ReplayControls
                timeframeMinutes={MASTER_TIMEFRAME_MINUTES}
                className="ml-auto"
              />
            </div>
          )}

          <div
            onPointerDown={onResizeStart}
            className="group h-1 shrink-0 cursor-ns-resize bg-border transition-colors hover:bg-primary/60"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize positions table"
          >
            <div className="mx-auto h-full w-12 rounded-full bg-foreground/10 group-hover:bg-foreground/20" />
          </div>

          <div
            className="shrink-0 overflow-hidden border-t border-border"
            style={{ height: `${tableHeight}px` }}
          >
            <Tabs defaultValue="open" className="flex h-full flex-col">
              <TabsList className="shrink-0 rounded-none bg-card/50 px-2">
                <TabsTrigger value="open">Open</TabsTrigger>
                <TabsTrigger value="closed">Closed</TabsTrigger>
              </TabsList>
              <TabsContent value="open" className="m-0 flex-1 overflow-auto">
                <OpenPositionsTable />
              </TabsContent>
              <TabsContent value="closed" className="m-0 flex-1 overflow-auto">
                <ClosedPositionsTable />
              </TabsContent>
            </Tabs>
          </div>

          <ScrubberBar className="shrink-0" />
        </section>

        {sidebarOpen && (
          <AccountSidebar
            onExit={onExit}
            onSubmitFinal={
              session?.attemptId ? () => setSubmitFinalOpen(true) : undefined
            }
          />
        )}

        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="absolute right-0 top-1/2 z-30 flex h-14 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border border-r-0 border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
          style={{ right: sidebarOpen ? "260px" : "0px" }}
          aria-label={sidebarOpen ? "Hide account panel" : "Show account panel"}
        >
          {sidebarOpen ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {symbol && (
        <PlaceOrderDialog
          open={dialogSide !== null}
          onOpenChange={(o) => !o && setDialogSide(null)}
          side={dialogSide ?? "buy"}
          symbol={symbol}
          defaultSize={1}
        />
      )}

      <SubmitFinalDialog
        open={submitFinalOpen}
        onOpenChange={setSubmitFinalOpen}
        onConfirm={onSubmitFinal}
      />

      {/* v2.3 sub-phase 3 (D8): "Ready?" intro on first entry only.
          showReadyIntro is set in the boot effect when the
          fx.freshAttempt sessionStorage flag matches this attempt.
          Resumes / rejoins leave it false and the overlay never
          mounts. Boot-gate matches CountdownTimer's so the overlay
          mounts after the chart is ready and not over a stale
          session. */}
      {/* v2.3 sub-phase 3: Ready intro — shows during boot AND after.
          The overlay is z-100, so it covers the boot loading state
          and provides a continuous transition from WaitingRoom →
          intro → trade UI. */}
      {showReadyIntro && session?.id === sessionId && (
        <ReadyIntroOverlay
          battleName={session?.name}
          onDone={() => {
            setShowReadyIntro(false);
            // Clear the fresh-attempt flag once the intro has
            // actually played, so subsequent reloads of this
            // attempt skip the intro. Reloading WITHIN the 3.6s
            // window will re-show the intro — acceptable.
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("fx.freshAttempt");
            }
          }}
        />
      )}

      {showEndedOverlay && (
        <SessionEndedOverlay
          reason={endedReason?.reason}
          session={session}
        />
      )}
    </main>
  );
}

/**
 * v2.2.5α: full-page absolute overlay shown on top of the trade UI when the
 * session has ended (live DQ or boot-of-ended-session). The chart and
 * positions table stay rendered behind the blur so the user has visual
 * context — they can see the price action that liquidated them. Order
 * entry is blocked at the orderStore layer regardless of overlay presence.
 */
function SessionEndedOverlay({
  reason,
  session,
}: {
  reason?: string;
  session: Session | null;
}) {
  const wasLiquidated = !!reason;
  // Pull this session's closed trades to compute the in-depth summary.
  // Filter via useMemo — selecting the array directly returns a stable
  // reference (Zustand only swaps `closedTrades` when it actually changes),
  // and useMemo recomputes the filter only when the array or session id
  // changes. Filtering INSIDE the selector returns a fresh array every
  // render → infinite loop.
  const allClosedTrades = useOrderStore((s) => s.closedTrades);
  const sessionId2 = session?.id;
  const closedTrades = useMemo(
    () =>
      sessionId2
        ? allClosedTrades.filter((t) => t.sessionId === sessionId2)
        : [],
    [allClosedTrades, sessionId2],
  );

  const summary = session ? buildSessionSummary(session, closedTrades) : null;

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/40 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-ended-title"
    >
      <div className="mx-6 max-w-2xl rounded-xl border border-border bg-card/95 px-8 py-8 shadow-2xl backdrop-blur">
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Session ended
          </div>
          <h1
            id="session-ended-title"
            className="mt-2 text-2xl font-semibold tracking-tight"
          >
            {wasLiquidated ? "Liquidated" : "Attempt complete"}
          </h1>
          {wasLiquidated && (
            <p className="mt-3 text-sm text-bear">{reason}</p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {wasLiquidated
              ? "All open positions were force-closed at the breach bar. Here's how the attempt played out:"
              : "Here's how the attempt played out:"}
          </p>
        </div>

        {summary && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SummaryStat
              label="Final balance"
              value={formatMoney(summary.finalBalance)}
              sublabel={`Started at ${formatMoney(summary.startingBalance)}`}
            />
            <SummaryStat
              label="P&L"
              value={formatMoney(summary.pnl, true)}
              sublabel={formatPercent(summary.pnlPct, 2)}
              tone={
                summary.pnl > 0 ? "bull" : summary.pnl < 0 ? "bear" : "neutral"
              }
            />
            <SummaryStat
              label="Trades"
              value={String(summary.tradeCount)}
              sublabel={
                summary.tradeCount === 0
                  ? "No trades closed"
                  : `${summary.wins}W · ${summary.losses}L`
              }
            />
            <SummaryStat
              label="Win rate"
              value={
                summary.winRate === null
                  ? "—"
                  : formatPercent(summary.winRate, 1)
              }
            />
            <SummaryStat
              label="Best trade"
              value={
                summary.bestTrade === null
                  ? "—"
                  : formatMoney(summary.bestTrade, true)
              }
              tone="bull"
            />
            <SummaryStat
              label="Worst trade"
              value={
                summary.worstTrade === null
                  ? "—"
                  : formatMoney(summary.worstTrade, true)
              }
              tone="bear"
            />
            <SummaryStat
              label="Avg trade"
              value={
                summary.avgPnl === null
                  ? "—"
                  : formatMoney(summary.avgPnl, true)
              }
            />
            <SummaryStat
              label="Commissions"
              value={formatMoney(summary.totalCommission)}
            />
            <SummaryStat
              label="Time in market"
              value={
                summary.timeInMarket === 0
                  ? "—"
                  : formatDuration(summary.timeInMarket)
              }
              sublabel={
                summary.mostTradedInstrument
                  ? `Most traded · ${summary.mostTradedInstrument}`
                  : undefined
              }
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {/* v2.3 sub-phase 3: route to /battles instead of the
              specific battle page. The attempt is finalized — no
              "back into the battle" affordance for a completed
              attempt (avoids duplicate-submission). User can still
              click the battle from /battles to view the leaderboard
              but won't land on a Start CTA. */}
          <Link
            href="/battles"
            className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            All battles
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

interface SessionSummary {
  startingBalance: number;
  finalBalance: number;
  pnl: number;
  pnlPct: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
  avgPnl: number | null;
  totalCommission: number;
  timeInMarket: number;
  mostTradedInstrument: string | null;
}

function buildSessionSummary(
  session: Session,
  trades: Trade[],
): SessionSummary {
  const startingBalance = session.startingBalance;
  const finalBalance = session.currentBalance;
  const pnl = finalBalance - startingBalance;
  const pnlPct = startingBalance > 0 ? pnl / startingBalance : 0;

  let wins = 0;
  let losses = 0;
  let bestTrade: number | null = null;
  let worstTrade: number | null = null;
  let totalCommission = 0;
  let timeInMarket = 0;
  const byInstrument = new Map<string, number>();

  for (const t of trades) {
    if (t.pnl > 0) wins++;
    else if (t.pnl < 0) losses++;
    if (bestTrade === null || t.pnl > bestTrade) bestTrade = t.pnl;
    if (worstTrade === null || t.pnl < worstTrade) worstTrade = t.pnl;
    totalCommission += t.commission;
    timeInMarket += t.duration;
    byInstrument.set(t.instrument, (byInstrument.get(t.instrument) ?? 0) + 1);
  }

  const decided = wins + losses;
  const winRate = decided === 0 ? null : wins / decided;
  const avgPnl = trades.length === 0 ? null : pnl / trades.length;

  let mostTradedInstrument: string | null = null;
  let topCount = 0;
  for (const [sym, n] of byInstrument) {
    if (n > topCount) {
      topCount = n;
      mostTradedInstrument = sym;
    }
  }

  return {
    startingBalance,
    finalBalance,
    pnl,
    pnlPct,
    tradeCount: trades.length,
    wins,
    losses,
    winRate,
    bestTrade,
    worstTrade,
    avgPnl,
    totalCommission,
    timeInMarket,
    mostTradedInstrument,
  };
}

function SummaryStat({
  label,
  value,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "bull" | "bear" | "neutral";
}) {
  const valueClass =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-left">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-mono text-sm font-semibold ${valueClass}`}>
        {value}
      </div>
      {sublabel && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          {sublabel}
        </div>
      )}
    </div>
  );
}
