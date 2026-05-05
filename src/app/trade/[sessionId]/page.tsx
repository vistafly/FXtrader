"use client";

import { useMutation } from "convex/react";
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
import { QuickBuySellPanel } from "@/components/trade/QuickBuySellPanel";
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
  // v2.2.5α: the focused pane's instrument drives order routing + the
  // QuickBuySellPanel symbol prop. Falls back to session.instrument before
  // the layoutStore is initialized (boot has not completed yet).
  const activePaneInstrument = useLayoutStore(selectActiveInstrument);

  // Boot the session: load from Dexie, fetch bars (one or many), seed the
  // engines via MasterClock, hardcode-init the layout from instruments.
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
  }, [sessionId]);

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

  const submitServerAttempt = useMutation(api.battles.submitAttempt);

  const onExitSession = async () => {
    await useSessionStore.getState().endSession({
      submitToServer: async (data) => {
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
    toast.success("Session ended.");
    router.push("/dashboard");
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
        </div>
        {/* v2.2.5α: layout selector — only meaningful for multi-asset
            sessions. Single-instrument sessions hide it since 1-pane is
            the only valid choice anyway. */}
        {session?.instruments && session.instruments.length > 1 && (
          <LayoutSelector />
        )}
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

        {sidebarOpen && <AccountSidebar onExit={onExitSession} />}

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
  // /battles/[battleId] expects a prefix-dispatched id (`local-<id>` or
  // `server-<id>`) per inviteCode.ts. Derive the prefix from the session's
  // battleSource. Falls back to /dashboard when there's no battle context.
  const battleHref =
    session?.battleId
      ? `/battles/${session.battleSource ?? "local"}-${session.battleId}`
      : "/dashboard";

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
          <a
            href={battleHref}
            className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Back to battle
          </a>
          <a
            href="/dashboard"
            className="inline-flex items-center rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Dashboard
          </a>
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
