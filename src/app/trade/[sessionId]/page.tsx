"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { ChartContainer } from "@/components/chart/ChartContainer";
import { ErrorBoundary } from "@/components/ErrorFallback";
import { ReplayControls } from "@/components/replay/ReplayControls";
import { ScrubberBar } from "@/components/replay/ScrubberBar";
import { AccountHUD } from "@/components/trade/AccountHUD";
import { AccountSidebar } from "@/components/trade/AccountSidebar";
import { ClosedPositionsTable } from "@/components/trade/ClosedPositionsTable";
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
import { BundledDataProvider } from "@/lib/data/BundledDataProvider";
import type { ResolutionString } from "@/lib/data/DataProvider";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { OrderSide } from "@/types/order";

const TIMEFRAMES: { label: string; value: ResolutionString }[] = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "1D" },
];

function resolutionToMinutes(r: ResolutionString): number {
  if (r === "1D") return 1440;
  const n = Number(r);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default function TradeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();

  const [resolution, setResolution] = useState<ResolutionString>("1");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootedFor, setBootedFor] = useState<string | null>(null);
  const [dialogSide, setDialogSide] = useState<OrderSide | null>(null);

  // Timeframe-overlay visibility — shows when the user is interacting with
  // the chart and fades out after a short idle window. Mirrors how
  // TradingView / FXReplay surface their timeframe pickers.
  const [tfVisible, setTfVisible] = useState(true);
  const tfHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TF_IDLE_MS = 2000;

  // Right sidebar visibility (collapsible). Closed by default — the
  // top-right AccountHUD covers the same metrics in a smaller footprint
  // when the user wants more chart real estate.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bottom positions-table height (resizable).
  const [tableHeight, setTableHeight] = useState(192);

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = tableHeight;
    const onMove = (ev: PointerEvent) => {
      // Drag UP = grow the table; DOWN = shrink. All the way down → 0
      // (table collapses entirely; the resize handle stays so the user can
      // drag it back up).
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

  const pingTimeframe = () => {
    setTfVisible(true);
    if (tfHideTimerRef.current) clearTimeout(tfHideTimerRef.current);
    tfHideTimerRef.current = setTimeout(() => setTfVisible(false), TF_IDLE_MS);
  };

  useEffect(() => {
    // Schedule the first idle-hide. Don't synchronously bump state here —
    // tfVisible already starts true. Subsequent activity reschedules via
    // pingTimeframe().
    tfHideTimerRef.current = setTimeout(
      () => setTfVisible(false),
      TF_IDLE_MS,
    );
    return () => {
      if (tfHideTimerRef.current) clearTimeout(tfHideTimerRef.current);
    };
  }, []);

  // Boot the session: load from Dexie if needed, fetch bars, seed the engine.
  useEffect(() => {
    let cancelled = false;
    const key = `${sessionId}/${resolution}`;

    async function boot() {
      try {
        // 1. Hydrate session if necessary (e.g. user reloaded the tab).
        let active = useSessionStore.getState().activeSession;
        if (!active || active.id !== sessionId) {
          await useSessionStore.getState().loadSession(sessionId);
          active = useSessionStore.getState().activeSession;
          // 2. Repopulate closed trades from Dexie so the closed-positions tab
          //    shows history. Open positions are not persisted (D2).
          useOrderStore.getState().resetForSession();
          const trades = await tradeRepository.listForSession(sessionId);
          if (trades.length > 0) {
            useOrderStore.setState({ closedTrades: trades });
          }
        }
        if (cancelled || !active) return;

        // 3. Load instrument bars and seat the engine.
        const provider = new BundledDataProvider({ baseUrl: "/data" });
        await useReplayStore
          .getState()
          .loadInstrument(provider, active.instrument, resolution);

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
    };
  }, [sessionId, resolution]);

  const symbol = session?.instrument ?? "";

  useKeyboardShortcuts({
    onOpenBuy: () => setDialogSide("buy"),
    onOpenSell: () => setDialogSide("sell"),
    symbol,
  });

  const onExitSession = async () => {
    await useSessionStore.getState().endSession();
    toast.success("Session ended.");
    router.push("/dashboard");
  };

  const loading = bootedFor !== `${sessionId}/${resolution}` && !bootError;

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">FXTrader</h1>
          {session && (
            <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {session.name} · {session.instrument}
            </span>
          )}
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <section className="flex flex-1 flex-col overflow-hidden">
          {/* min-h-0 fixes the flexbox-children-ignore-bounds issue.
              Without it, growing the position table pushes the bottom controls
              off-screen instead of capping the chart. */}
          <div
            className="relative flex-1 min-h-0 bg-background"
            onMouseMove={pingTimeframe}
            onPointerDown={pingTimeframe}
          >
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
            {symbol && (
              <ErrorBoundary
                label="Chart"
                hint="The chart failed to render. Try selecting a different timeframe or instrument."
                className="absolute inset-4"
              >
                <ChartContainer symbol={symbol} />
              </ErrorBoundary>
            )}

            {/* Glassy account HUD — top-right of the chart. Hides when the
                full account sidebar is open (the sidebar shows the same
                info expanded, so the HUD would be redundant). */}
            {!sidebarOpen && <AccountHUD />}

            {/* Timeframe selector — overlaid horizontally centered, just
                above the chart's time-axis strip. Auto-fades on idle and
                returns on chart interaction. */}
            <div
              className={cn(
                "pointer-events-none absolute bottom-7 left-1/2 z-20 -translate-x-1/2 transition-opacity duration-300",
                tfVisible ? "opacity-100" : "opacity-0",
              )}
              onMouseEnter={pingTimeframe}
            >
              <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-border bg-background/90 p-0.5 font-mono text-xs shadow-md backdrop-blur">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => {
                      setResolution(tf.value);
                      pingTimeframe();
                    }}
                    className={cn(
                      "rounded px-2 py-1 transition-colors",
                      resolution === tf.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={resolution === tf.value}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Combined controls row: order entry on the left, replay controls on the right. */}
          {symbol && (
            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card/50 px-4 py-2">
              <QuickBuySellPanel symbol={symbol} />
              <ReplayControls
                timeframeMinutes={resolutionToMinutes(resolution)}
                className="ml-auto"
              />
            </div>
          )}

          {/* Resize handle for the positions table */}
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

        {/* Sidebar collapse / expand toggle — always visible at the right edge */}
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
    </main>
  );
}
