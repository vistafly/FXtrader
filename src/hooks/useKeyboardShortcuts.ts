"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { getInstrument } from "@/lib/instruments/instruments";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { OrderSide } from "@/types/order";
import type { SpeedSetting } from "@/types/session";

interface Options {
  /** Open the buy dialog (B). */
  onOpenBuy?: () => void;
  /** Open the sell dialog (S). */
  onOpenSell?: () => void;
  /** Currently-displayed symbol. Required for one-click market shortcuts. */
  symbol: string;
}

/**
 * Spec §11 keyboard shortcuts. Route-gated to /trade/* and input-gated so
 * typing in dialogs/inputs doesn't trigger.
 *
 *   Space      Play / Pause
 *   ← / →      Step bar back / forward
 *   1-5        Set speed 1× / 2× / 4× / 8× / 16×
 *   B / S      Open Buy / Sell dialog
 *   M          Quick market buy (one-click trading must be enabled)
 *   Shift+M    Quick market sell (same)
 *   Esc        Close dialogs (browser default + Radix-managed)
 *   Ctrl+Z     Cancel last unfilled pending order
 */
export function useKeyboardShortcuts({ onOpenBuy, onOpenSell, symbol }: Options) {
  const pathname = usePathname();

  useEffect(() => {
    const enabled = useSettingsStore.getState().keyboardShortcutsEnabled;
    if (!enabled) return;
    if (!pathname?.startsWith("/trade/")) return;

    const handler = (e: KeyboardEvent) => {
      // Input-gate: skip if focus is in any text-entry element.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isEditable =
        tag === "input" ||
        tag === "textarea" ||
        tag === "select" ||
        (e.target as HTMLElement | null)?.isContentEditable;
      if (isEditable) return;

      const replay = useReplayStore.getState();

      const setSpeed = (s: SpeedSetting) => replay.setSpeed(s);

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (replay.isPlaying) replay.pause();
          else replay.play();
          return;
        case "ArrowLeft":
          e.preventDefault();
          replay.step("back");
          return;
        case "ArrowRight":
          e.preventDefault();
          replay.step("forward");
          return;
        case "1":
          setSpeed(1);
          return;
        case "2":
          setSpeed(2);
          return;
        case "3":
          setSpeed(4);
          return;
        case "4":
          setSpeed(8);
          return;
        case "5":
          setSpeed(16);
          return;
        case "b":
        case "B":
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          onOpenBuy?.();
          return;
        case "s":
        case "S":
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          e.preventDefault();
          onOpenSell?.();
          return;
        case "m":
        case "M": {
          if (e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          if (!useSettingsStore.getState().oneClickTradingEnabled) {
            toast.info("Enable one-click trading in settings to use M / Shift+M.");
            return;
          }
          const side: OrderSide = e.shiftKey ? "sell" : "buy";
          quickMarket(symbol, side);
          return;
        }
        case "z":
        case "Z":
          if (!(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          undoLastOrder();
          return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pathname, onOpenBuy, onOpenSell, symbol]);
}

async function quickMarket(symbol: string, side: OrderSide) {
  const session = useSessionStore.getState().activeSession;
  if (!session) {
    toast.error("Start a session first.");
    return;
  }
  const price = useReplayStore.getState().engine?.getCurrentPrice();
  if (price == null) return;
  const inst = getInstrument(symbol);
  const { defaultLotSize, defaultStopLossPips, defaultTakeProfitPips } =
    useSettingsStore.getState();
  const slDelta = defaultStopLossPips * inst.pipSize;
  const tpDelta = defaultTakeProfitPips * inst.pipSize;
  await useOrderStore.getState().submitOrder({
    sessionId: session.id,
    instrument: symbol,
    side,
    type: "market",
    size: defaultLotSize,
    stopLoss: side === "buy" ? price - slDelta : price + slDelta,
    takeProfit: side === "buy" ? price + tpDelta : price - tpDelta,
  });
  toast.success(`Quick ${side} ${defaultLotSize} ${symbol}.`);
}

async function undoLastOrder() {
  const pending = useOrderStore.getState().pendingOrders;
  if (pending.length === 0) {
    toast.info("Nothing to undo.");
    return;
  }
  const last = pending[pending.length - 1];
  await useOrderStore.getState().cancelOrder(last.id);
  toast.success("Order cancelled.");
}
