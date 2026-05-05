"use client";

import { useEffect, useRef } from "react";

import { useLayoutStore } from "@/stores/layoutStore";

import type { ChartProviderHandle } from "../ChartProvider.types";

/**
 * v2.2.5α: draggable HTML chip for the pre-trade limit/stop preview line
 * drawn by ChartContainer.syncSlPreview. The chip sits at the right edge
 * of the chart at the same Y as the preview line; pointer-drag updates
 * `layoutStore.previewTriggerOverride`, which QuickBuySellPanel mirrors
 * into its trigger-price input — so chart-side drag and keyboard input
 * stay in sync.
 *
 * Mounted alongside PositionDragOverlay inside ChartContainer.
 */
export function PreviewTriggerDrag({
  handleRef,
  handleReady,
  symbol,
}: {
  handleRef: React.RefObject<ChartProviderHandle | null>;
  handleReady: boolean;
  symbol: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const slPreview = useLayoutStore((s) => s.slPreview);
  const setPreviewTriggerOverride = useLayoutStore(
    (s) => s.setPreviewTriggerOverride,
  );

  useEffect(() => {
    const overlay = overlayRef.current;
    const handle = handleRef.current;
    if (!overlay || !handle || !handleReady) return;
    // Show only when the panel has set a triggerPrice for THIS pane's
    // symbol (slPreview's symbol must match this overlay's symbol).
    const active =
      !!slPreview &&
      slPreview.symbol === symbol &&
      slPreview.triggerPrice !== undefined;
    if (!active) return;

    const chip = document.createElement("div");
    Object.assign(chip.style, {
      position: "absolute",
      right: "60px",
      transform: "translateY(-50%)",
      padding: "3px 8px",
      borderRadius: "9999px",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: "10px",
      fontWeight: "600",
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "#fff",
      background: "rgba(138, 140, 145, 0.95)",
      cursor: "ns-resize",
      userSelect: "none",
      pointerEvents: "auto",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
      zIndex: "55",
    } as Partial<CSSStyleDeclaration>);
    // Preview chip is drag-only (no X button). The X belongs on the
    // ord-trigger chip in PositionDragOverlay, which appears once the
    // order is actually placed — clicking that X cancels the live order.
    // Putting an X here would dismiss the staging preview and force the
    // user to re-cycle the order type to bring it back, which broke the
    // multi-order flow.
    chip.textContent = `⋮⋮ ${slPreview.triggerKind === "limit" ? "LIMIT" : "STOP"}`;
    overlay.appendChild(chip);

    // Drag handler: pointer Y → price via handle.yToPrice → write to
    // layoutStore.previewTriggerOverride.
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      chip.setPointerCapture(e.pointerId);

      // No clamp: the staging trigger can be dragged anywhere. The SL/TP
      // previews slide with the trigger (pivot anchors them in
      // QuickBuySellPanel), so they always stay on the correct side of
      // the entry — the trigger never visually crosses them.
      const onMove = (ev: PointerEvent) => {
        const overlayRect = overlay.getBoundingClientRect();
        const localY = ev.clientY - overlayRect.top;
        const price = handle.yToPrice(localY);
        if (price == null || !Number.isFinite(price) || price <= 0) return;
        setPreviewTriggerOverride({ symbol, price });
      };
      const onUp = () => {
        chip.removeEventListener("pointermove", onMove);
        chip.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      chip.addEventListener("pointermove", onMove);
      chip.addEventListener("pointerup", onUp);
      // Document-level fallback: native canvas events can swallow
      // pointermove on the chip element.
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    };
    chip.addEventListener("pointerdown", onDown);

    // rAF tick: track the chip's Y position to the trigger-line Y. The
    // chart's coordinate system can shift on pan/zoom/scroll, so we
    // recompute every frame.
    let raf = 0;
    const tick = () => {
      const px = handle.priceToY(slPreview.triggerPrice as number);
      if (px == null) {
        chip.style.display = "none";
      } else {
        chip.style.display = "block";
        chip.style.top = `${px}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      chip.removeEventListener("pointerdown", onDown);
      if (chip.parentNode) chip.parentNode.removeChild(chip);
    };
  }, [
    handleRef,
    handleReady,
    symbol,
    slPreview,
    setPreviewTriggerOverride,
  ]);

  return (
    <div
      ref={overlayRef}
      className="pointer-events-none absolute inset-0 z-40"
    />
  );
}
