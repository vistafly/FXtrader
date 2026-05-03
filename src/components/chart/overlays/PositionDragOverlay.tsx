"use client";

import { useEffect, useRef } from "react";

import { computePnl } from "@/lib/engine/MatchingEngine";
import { getInstrument } from "@/lib/instruments/instruments";
import { useOrderStore } from "@/stores/orderStore";
import { useReplayStore } from "@/stores/replayStore";
import type { Order } from "@/types/order";
import type { Position } from "@/types/position";

import type { ChartProviderHandle } from "../ChartProvider.types";

type ChipKind = "pos-entry" | "pos-tp" | "pos-sl" | "ord-trigger";

interface ChipMeta {
  key: string;
  ownerId: string;
  kind: ChipKind;
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  gripEl: HTMLSpanElement | null;
}

const COLORS = {
  bull: "#16C784", // normal TP — profit target
  bear: "#EA3943", // normal SL — loss cap
  pending: "#8A8C91",
  bg: "rgba(15, 17, 22, 0.92)",
  // Anomaly-case shades — subtly distinct from the conventional pair so the
  // user can tell at a glance that this isn't a "normal" TP/SL pairing.
  slProfit: "#06B6A4", // SL trailed into profit territory (locking gains)
  tpLoss: "#D97706",   // TP capping a loss (rare; user-driven)
};

// Right-edge anchoring constants (in px).
const ENTRY_RIGHT = 60;
const RIBBON_GAP = 8;
// Approximate chip widths used to place placeholder TP/SL alongside the entry
// chip as a horizontal ribbon. Real chip widths drift slightly with content
// length; the small overlap doesn't matter visually.
const ENTRY_WIDTH_GUESS = 110;
const PLACEHOLDER_WIDTH_GUESS = 70;

const TP_PLACEHOLDER_RIGHT =
  ENTRY_RIGHT + ENTRY_WIDTH_GUESS + RIBBON_GAP;
const SL_PLACEHOLDER_RIGHT =
  TP_PLACEHOLDER_RIGHT + PLACEHOLDER_WIDTH_GUESS + RIBBON_GAP;

/**
 * Right-edge chip overlay. Per Phase 5 user-feedback iteration:
 *   - Entry, TP, and SL chips for every open position. Always rendered.
 *   - Entry: no grip, no L/S prefix, just "<size> <±$pnl>". Read-only.
 *   - TP/SL when value is unset (placeholder): outlined dashed pill with
 *     "⋮⋮ + TP" / "⋮⋮ + SL", anchored on the same Y as the entry chip in a
 *     horizontal ribbon. NO canvas line drawn.
 *   - TP/SL when value is set (active): filled pill with grip + price + $.
 *     Anchored vertically at the actual TP/SL price; canvas dashed line shows.
 *   - Pending limit/stop trigger: gray draggable pill at trigger price.
 *
 * Drag mechanics: each draggable chip uses pointer-capture for primary
 * tracking PLUS document-level pointermove/pointerup listeners as fallback,
 * since lightweight-charts' canvas can otherwise consume pointermove events.
 */
export function PositionDragOverlay({
  handleRef,
  symbol,
}: {
  handleRef: React.RefObject<ChartProviderHandle | null>;
  symbol: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const positions = useOrderStore((s) => s.openPositions);
  const pendingOrders = useOrderStore((s) => s.pendingOrders);
  const modifyPosition = useOrderStore((s) => s.modifyPosition);
  const modifyOrder = useOrderStore((s) => s.modifyOrder);

  useEffect(() => {
    const overlay = overlayRef.current;
    const provider = handleRef.current;
    if (!overlay || !provider) return;

    const overlayEl = overlay;
    const chart = provider;
    const inst = getInstrument(symbol);
    const chips: ChipMeta[] = [];

    const makeChip = (
      key: string,
      ownerId: string,
      kind: ChipKind,
      withGrip: boolean,
    ): ChipMeta => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        right: `${ENTRY_RIGHT}px`,
        transform: "translateY(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px",
        borderRadius: "9999px",
        fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: "12px",
        fontWeight: "600",
        lineHeight: "16px",
        whiteSpace: "nowrap",
        userSelect: "none",
        boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
        zIndex: "50",
        transition: "transform 80ms ease, box-shadow 80ms ease, opacity 80ms ease",
      } as Partial<CSSStyleDeclaration>);

      let grip: HTMLSpanElement | null = null;
      if (withGrip) {
        grip = document.createElement("span");
        grip.textContent = "⋮⋮";
        Object.assign(grip.style, {
          opacity: "0.75",
          letterSpacing: "-2px",
          fontSize: "10px",
        } as Partial<CSSStyleDeclaration>);
        el.appendChild(grip);
      }

      const text = document.createElement("span");
      text.className = "chip-text";
      el.appendChild(text);

      el.addEventListener("mouseenter", () => {
        if (el.style.cursor === "ns-resize") {
          el.style.transform = "translateY(-50%) scale(1.05)";
          el.style.boxShadow = "0 4px 14px rgba(0,0,0,0.6)";
        }
      });
      el.addEventListener("mouseleave", () => {
        el.style.transform = "translateY(-50%)";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";
      });

      overlayEl.appendChild(el);
      return { key, ownerId, kind, el, textEl: text, gripEl: grip };
    };

    function attachDrag(meta: ChipMeta, onCommit: (price: number) => void) {
      const el = meta.el;
      let dragging = false;

      const computePrice = (clientY: number) => {
        const rect = overlayEl.getBoundingClientRect();
        const localY = clientY - rect.top;
        return chart.yToPrice(localY);
      };

      const beginDrag = () => {
        dragging = true;
        document.body.style.cursor = "ns-resize";
        el.style.transform = "translateY(-50%) scale(1.08)";
        el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.7)";
        el.style.opacity = "0.95";
      };
      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        document.body.style.cursor = "";
        el.style.transform = "translateY(-50%)";
        el.style.boxShadow = "0 2px 6px rgba(0,0,0,0.5)";
        el.style.opacity = "1";
      };

      // Document-level fallback. lightweight-charts' canvas can swallow
      // pointermove on the chart area otherwise.
      const docMove = (ev: PointerEvent) => {
        if (!dragging) return;
        const newPrice = computePrice(ev.clientY);
        if (newPrice == null) return;
        onCommit(Number(newPrice.toFixed(inst.priceDecimals)));
      };
      const docUp = () => {
        endDrag();
        document.removeEventListener("pointermove", docMove);
        document.removeEventListener("pointerup", docUp);
        document.removeEventListener("pointercancel", docUp);
      };

      const onDown = (e: PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        beginDrag();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore — fall back to document listeners
        }
        document.addEventListener("pointermove", docMove);
        document.addEventListener("pointerup", docUp);
        document.addEventListener("pointercancel", docUp);
      };

      el.addEventListener("pointerdown", onDown);
    }

    const applyMode = (
      meta: ChipMeta,
      mode: "active" | "placeholder",
      color: string,
      draggable: boolean,
    ) => {
      const { el, gripEl } = meta;
      if (mode === "active") {
        el.style.background = color;
        el.style.color = "#FFFFFF";
        el.style.border = "none";
        if (gripEl) gripEl.style.color = "#FFFFFF";
      } else {
        el.style.background = COLORS.bg;
        el.style.color = color;
        el.style.border = `1px dashed ${color}`;
        if (gripEl) gripEl.style.color = color;
      }
      el.style.cursor = draggable ? "ns-resize" : "default";
      el.style.pointerEvents = draggable ? "auto" : "none";
    };

    /**
     * SL must stay on the side of the current market that the position
     * profits from when reaching it. SL on the wrong side would auto-fire
     * the very next bar (bar.low ≤ SL is trivially true for a long when
     * SL > current; symmetrically for a short).
     *
     *   Long  SL: ≤ currentPrice
     *   Short SL: ≥ currentPrice
     */
    const clampSl = (p: Position, dragPrice: number): number => {
      const market = useReplayStore.getState().engine?.getCurrentPrice();
      if (market == null) return dragPrice;
      return p.side === "buy"
        ? Math.min(dragPrice, market)
        : Math.max(dragPrice, market);
    };

    /**
     * TP must stay on the side of the current market that the position
     * profits from. TP on the wrong side would auto-fire the next bar
     * (long: bar.high ≥ TP is trivially true when TP < current;
     * short: bar.low ≤ TP is trivially true when TP > current).
     *
     *   Long  TP: ≥ currentPrice
     *   Short TP: ≤ currentPrice
     */
    const clampTp = (p: Position, dragPrice: number): number => {
      const market = useReplayStore.getState().engine?.getCurrentPrice();
      if (market == null) return dragPrice;
      return p.side === "buy"
        ? Math.max(dragPrice, market)
        : Math.min(dragPrice, market);
    };

    /**
     * Append a small "×" close button to a chip's DOM. The chip itself can
     * still be pointer-events:none — pointerEvents:auto on the button is
     * what makes it interactive.
     */
    const addCloseButton = (chip: ChipMeta, onClose: () => void) => {
      const btn = document.createElement("span");
      btn.textContent = "×";
      Object.assign(btn.style, {
        marginLeft: "4px",
        padding: "0 5px",
        borderRadius: "9999px",
        cursor: "pointer",
        opacity: "0.7",
        pointerEvents: "auto",
        fontSize: "13px",
        fontWeight: "700",
        lineHeight: "1",
        transition: "opacity 80ms ease, background-color 80ms ease",
      } as Partial<CSSStyleDeclaration>);
      btn.addEventListener("mouseenter", () => {
        btn.style.opacity = "1";
        btn.style.background = "rgba(0,0,0,0.25)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.opacity = "0.7";
        btn.style.background = "transparent";
      });
      // Use pointerdown w/ stopPropagation so the chip's drag listener
      // doesn't engage when the user is clicking the close.
      btn.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClose();
      });
      chip.el.appendChild(btn);
    };

    // ---- Build chips for current state ----
    for (const p of positions) {
      if (p.instrument !== symbol) continue;

      const entry = makeChip(`pos-${p.id}-entry`, p.id, "pos-entry", false);
      // X to close immediately. Pointer-events:auto on the button is what
      // makes it work even though the entry chip itself is non-interactive.
      addCloseButton(entry, () => useOrderStore.getState().closePosition(p.id));
      chips.push(entry);

      const tp = makeChip(`pos-${p.id}-tp`, p.id, "pos-tp", true);
      attachDrag(tp, (price) => modifyPosition(p.id, { tp: clampTp(p, price) }));
      chips.push(tp);

      const sl = makeChip(`pos-${p.id}-sl`, p.id, "pos-sl", true);
      attachDrag(sl, (price) => modifyPosition(p.id, { sl: clampSl(p, price) }));
      chips.push(sl);
    }

    for (const o of pendingOrders) {
      if (o.instrument !== symbol) continue;
      if (o.type === "market") continue;
      const trig = makeChip(`ord-${o.id}-trig`, o.id, "ord-trigger", true);
      attachDrag(trig, (price) => {
        if (o.type === "limit") modifyOrder(o.id, { limitPrice: price });
        else modifyOrder(o.id, { stopPrice: price });
      });
      chips.push(trig);
    }

    // ---- rAF loop: keep Y, X-anchor, label, and visual mode in sync ----
    let raf = 0;
    const tick = () => {
      const open = useOrderStore.getState().openPositions;
      const pending = useOrderStore.getState().pendingOrders;

      for (const c of chips) {
        let y: number | null = null;
        let rightPx = ENTRY_RIGHT;
        let labelText = "";

        if (c.kind === "pos-entry" || c.kind === "pos-tp" || c.kind === "pos-sl") {
          const p: Position | undefined = open.find((x) => x.id === c.ownerId);
          if (!p) {
            c.el.style.display = "none";
            continue;
          }

          const entryY = chart.priceToY(p.entryPrice);

          if (c.kind === "pos-entry") {
            y = entryY;
            const sign = p.unrealizedPnl >= 0 ? "+" : "−";
            // No L/S prefix, no grip. Just size + P&L.
            labelText = `${p.size}  ${sign}$${Math.abs(p.unrealizedPnl).toFixed(2)}`;
            applyMode(
              c,
              "active",
              p.unrealizedPnl >= 0 ? COLORS.bull : COLORS.bear,
              false,
            );
          } else if (c.kind === "pos-tp") {
            if (p.takeProfit !== undefined) {
              y = chart.priceToY(p.takeProfit);
              const tpPnl = computePnl(inst, p.side, p.entryPrice, p.takeProfit, p.size);
              // Normal TP locks profit → bull green. A TP dragged into loss
              // territory (rare) gets the amber "anomaly" tint to flag it.
              const sign = tpPnl >= 0 ? "+" : "−";
              const color = tpPnl >= 0 ? COLORS.bull : COLORS.tpLoss;
              labelText = `TP ${p.takeProfit.toFixed(inst.priceDecimals)}  ${sign}$${Math.abs(tpPnl).toFixed(2)}`;
              applyMode(c, "active", color, true);
            } else {
              // Placeholder — same Y as entry chip, offset to the LEFT in the ribbon.
              y = entryY;
              rightPx = TP_PLACEHOLDER_RIGHT;
              labelText = "+ TP";
              applyMode(c, "placeholder", COLORS.bull, true);
            }
          } else if (c.kind === "pos-sl") {
            if (p.stopLoss !== undefined) {
              y = chart.priceToY(p.stopLoss);
              const slPnl = computePnl(inst, p.side, p.entryPrice, p.stopLoss, p.size);
              // Normal SL caps loss → bear red. A trailing SL above entry on
              // a long locks profit → teal (green family, distinct from TP).
              const sign = slPnl >= 0 ? "+" : "−";
              const color = slPnl >= 0 ? COLORS.slProfit : COLORS.bear;
              labelText = `SL ${p.stopLoss.toFixed(inst.priceDecimals)}  ${sign}$${Math.abs(slPnl).toFixed(2)}`;
              applyMode(c, "active", color, true);
            } else {
              y = entryY;
              rightPx = SL_PLACEHOLDER_RIGHT;
              labelText = "+ SL";
              applyMode(c, "placeholder", COLORS.bear, true);
            }
          }
        } else if (c.kind === "ord-trigger") {
          const o: Order | undefined = pending.find((x) => x.id === c.ownerId);
          if (!o) {
            c.el.style.display = "none";
            continue;
          }
          const trig = o.type === "limit" ? o.limitPrice : o.stopPrice;
          if (trig !== undefined) {
            y = chart.priceToY(trig);
            const tag = o.type === "limit" ? "LMT" : "STP";
            labelText = `${tag} ${o.side === "buy" ? "B" : "S"} ${trig.toFixed(inst.priceDecimals)}`;
            applyMode(c, "active", COLORS.pending, true);
          }
        }

        if (y == null) {
          c.el.style.display = "none";
          continue;
        }
        c.el.style.display = "flex";
        c.el.style.top = `${y}px`;
        c.el.style.right = `${rightPx}px`;
        if (c.textEl.textContent !== labelText) c.textEl.textContent = labelText;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      for (const c of chips) c.el.remove();
    };
  }, [positions, pendingOrders, symbol, modifyPosition, modifyOrder, handleRef]);

  return (
    <div
      ref={overlayRef}
      // overflow-hidden clips chips at the chart's bounds — without it, chips
      // near the bottom of the visible price range would bleed into the
      // position-table row below the chart (their `transform: translateY(-50%)`
      // means the bottom half extends past the price's Y).
      className="pointer-events-none absolute inset-0 z-[40] overflow-hidden"
      aria-hidden
    />
  );
}
