"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getInstrument } from "@/lib/instruments/instruments";
import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";

const moneyFmt = (n: number) =>
  (n >= 0 ? "+$" : "-$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const reasonLabel: Record<string, string> = {
  manual: "manual",
  tp: "TP",
  sl: "SL",
  liquidated: "liquidated",
};

export function ClosedPositionsTable() {
  const trades = useOrderStore((s) => s.closedTrades);

  if (trades.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">
        No closed trades yet.
      </div>
    );
  }

  // Most recent first.
  const sorted = [...trades].sort((a, b) => b.exitTime - a.exitTime);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Asset</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead className="text-right">Entry</TableHead>
          <TableHead className="text-right">Exit</TableHead>
          <TableHead className="text-right">Pips</TableHead>
          <TableHead className="text-right">Realized</TableHead>
          <TableHead>Closed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((t) => {
          const inst = getInstrument(t.instrument);
          const fmt = (n: number) => n.toFixed(inst.priceDecimals);
          return (
            <TableRow key={t.id}>
              <TableCell className="font-mono">{t.instrument}</TableCell>
              <TableCell>
                <span className={cn("font-semibold", t.side === "buy" ? "text-bull" : "text-bear")}>
                  {t.side === "buy" ? "LONG" : "SHORT"}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono">{t.size}</TableCell>
              <TableCell className="text-right font-mono">{fmt(t.entryPrice)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(t.exitPrice)}</TableCell>
              <TableCell className={cn("text-right font-mono", t.pips >= 0 ? "text-bull" : "text-bear")}>
                {t.pips >= 0 ? "+" : ""}
                {t.pips.toFixed(1)}
              </TableCell>
              <TableCell className={cn("text-right font-mono", t.pnl >= 0 ? "text-bull" : "text-bear")}>
                {moneyFmt(t.pnl)}
              </TableCell>
              <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                {reasonLabel[t.closeReason] ?? t.closeReason}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
