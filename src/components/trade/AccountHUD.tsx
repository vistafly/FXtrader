"use client";

import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { selectFreeMargin, useSessionStore } from "@/stores/sessionStore";

/**
 * Compact, glassy HUD overlay anchored top-left of the chart. Surfaces the
 * highest-leverage account metrics — P&L (size + percent), balance, equity,
 * margin used, free margin — with the trading-convention color rules.
 *
 * Collapsible to a single P&L pill so it never crowds the chart on a small
 * screen but is one click away from full detail.
 */
export function AccountHUD({ className }: { className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const session = useSessionStore((s) => s.activeSession);
  const balance = useSessionStore((s) => s.balance);
  const equity = useSessionStore((s) => s.equity);
  const marginUsed = useSessionStore((s) => s.marginUsed);
  const freeMargin = useSessionStore(selectFreeMargin);

  if (!session) return null;

  // Total = what your account is up/down right now (realized + unrealized).
  // Unrealized = floating P&L on still-open positions (Eq − Bal).
  // Realized is implicit (Bal − startingBalance) so we don't display it.
  const totalPnl = equity - session.startingBalance;
  const unrealizedPnl = equity - balance;
  const pnlPct = (totalPnl / session.startingBalance) * 100;
  const isProfit = totalPnl >= 0;
  const accent = isProfit ? "text-bull" : "text-bear";

  return (
    <div className={cn("absolute top-3 right-24 z-20 select-none", className)}>
      <div className="rounded-xl border border-border/80 bg-card/60 shadow-2xl backdrop-blur-md ring-1 ring-white/5 transition-all">
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 rounded-xl transition-colors"
            aria-label="Expand account HUD"
          >
            {isProfit ? (
              <TrendingUp className="h-3 w-3 text-bull" />
            ) : (
              <TrendingDown className="h-3 w-3 text-bear" />
            )}
            <span className={cn("font-mono text-xs font-semibold tabular-nums", accent)}>
              {money(totalPnl, true)}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        ) : (
          <div className="flex w-[240px] flex-col gap-2.5 px-3 py-2.5">
            {/* Header row — session name + collapse toggle */}
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                {session.name}
              </span>
              <button
                onClick={() => setCollapsed(true)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Collapse account HUD"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
            </div>

            {/* Hero — total P&L (realized + unrealized). The trader's headline. */}
            <div className="flex items-baseline gap-2">
              {isProfit ? (
                <TrendingUp className={cn("h-4 w-4", accent)} />
              ) : (
                <TrendingDown className={cn("h-4 w-4", accent)} />
              )}
              <span className={cn("font-mono text-lg font-bold tabular-nums leading-none", accent)}>
                {money(totalPnl, true)}
              </span>
              <span className={cn("font-mono text-[11px] tabular-nums opacity-75", accent)}>
                {isProfit ? "+" : ""}
                {pnlPct.toFixed(2)}%
              </span>
            </div>

            {/* Unrealized P&L — realized is implicit (Bal − startingBalance)
                so we don't show both. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              <Stat
                label="Unrealized"
                value={money(unrealizedPnl, true)}
                accent={unrealizedPnl >= 0 ? "text-bull" : "text-bear"}
              />
            </div>

            {/* Account stat grid — compact money formatting so large
                balances don't overflow the 2-column layout. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[11px]">
              <Stat label="Bal" value={compactMoney(balance)} />
              <Stat label="Eq" value={compactMoney(equity)} />
              <Stat label="Used" value={compactMoney(marginUsed)} />
              <Stat
                label="Avail"
                value={compactMoney(freeMargin)}
                accent={freeMargin < 0 ? "text-bear" : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular-nums text-foreground", accent)}>{value}</span>
    </div>
  );
}

function money(n: number, signed = false): string {
  const positive = n >= 0;
  const sign = signed ? (positive ? "+" : "−") : positive ? "" : "−";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Tight currency format for the secondary HUD stats. Switches to k/M
 * suffixes for large values so a $1,000,000 balance doesn't overflow the
 * narrow grid column.
 */
function compactMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
