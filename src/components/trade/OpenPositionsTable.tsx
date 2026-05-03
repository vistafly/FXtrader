"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getInstrument } from "@/lib/instruments/instruments";
import { cn } from "@/lib/utils";
import { useOrderStore } from "@/stores/orderStore";

const moneyFmt = (n: number) =>
  (n >= 0 ? "+$" : "-$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function OpenPositionsTable() {
  const positions = useOrderStore((s) => s.openPositions);
  const closePosition = useOrderStore((s) => s.closePosition);
  const modifyPosition = useOrderStore((s) => s.modifyPosition);

  if (positions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted-foreground">
        No open positions.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-right">Entry</TableHead>
            <TableHead className="text-right">TP</TableHead>
            <TableHead className="text-right">SL</TableHead>
            <TableHead className="text-right">Unrealized</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((p) => {
            const inst = getInstrument(p.instrument);
            const fmt = (n: number | undefined) => (n == null ? "—" : n.toFixed(inst.priceDecimals));
            return (
              <TableRow key={p.id} className={cn(p._pendingClose && "opacity-50")}>
                <TableCell className="font-mono">{p.instrument}</TableCell>
                <TableCell>
                  <span className={cn("font-semibold", p.side === "buy" ? "text-bull" : "text-bear")}>
                    {p.side === "buy" ? "LONG" : "SHORT"}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono">{p.size}</TableCell>
                <TableCell className="text-right font-mono">{fmt(p.entryPrice)}</TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-bull",
                    p.takeProfit !== undefined && "cursor-pointer hover:line-through hover:opacity-70",
                  )}
                  onClick={() => p.takeProfit !== undefined && modifyPosition(p.id, { tp: undefined })}
                  title={p.takeProfit !== undefined ? "Click to remove TP" : undefined}
                >
                  {fmt(p.takeProfit)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-bear",
                    p.stopLoss !== undefined && "cursor-pointer hover:line-through hover:opacity-70",
                  )}
                  onClick={() => p.stopLoss !== undefined && modifyPosition(p.id, { sl: undefined })}
                  title={p.stopLoss !== undefined ? "Click to remove SL" : undefined}
                >
                  {fmt(p.stopLoss)}
                </TableCell>
                <TableCell className={cn("text-right font-mono", p.unrealizedPnl >= 0 ? "text-bull" : "text-bear")}>
                  {moneyFmt(p.unrealizedPnl)}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => closePosition(p.id)}
                        disabled={p._pendingClose}
                        aria-label="Close position on next bar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {p._pendingClose ? "Closing on next bar…" : "Close on next bar open"}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}
