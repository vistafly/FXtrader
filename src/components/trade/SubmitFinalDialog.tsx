"use client";

import { Flag } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called only after the user confirms. */
  onConfirm: () => Promise<void> | void;
}

/**
 * v2.3 sub-phase 2B: confirm modal for "Submit Final" — the destructive
 * finalize action. Shows a preview of the final stats so the user
 * understands exactly what they're locking in. Single confirm button
 * (vs. two-step typing friction); the destructive styling + the
 * explicit stats block carries enough weight without forcing the
 * user to type the battle name (we reserve the name-typing pattern
 * for "Abandon attempt", which throws away the attempt entirely —
 * Submit Final at least preserves the result on the leaderboard).
 */
export function SubmitFinalDialog({ open, onOpenChange, onConfirm }: Props) {
  const session = useSessionStore((s) => s.activeSession);
  const balance = useSessionStore((s) => s.balance);
  const allClosedTrades = useOrderStore((s) => s.closedTrades);

  const stats = useMemo(() => {
    if (!session) return null;
    const sessionTrades = allClosedTrades.filter(
      (t) => t.sessionId === session.id,
    );
    const wins = sessionTrades.filter((t) => t.pnl > 0).length;
    const winRate =
      sessionTrades.length > 0 ? (wins / sessionTrades.length) * 100 : 0;
    const pnl = balance - session.startingBalance;
    const pnlPct =
      session.startingBalance > 0 ? (pnl / session.startingBalance) * 100 : 0;
    return {
      finalBalance: balance,
      pnl,
      pnlPct,
      trades: sessionTrades.length,
      wins,
      winRate,
    };
  }, [session, balance, allClosedTrades]);

  if (!stats) return null;

  const isProfit = stats.pnl >= 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Submit Final?
          </DialogTitle>
          <DialogDescription>
            This locks the attempt result on the leaderboard. You won&apos;t be
            able to resume or change it.
          </DialogDescription>
        </DialogHeader>

        <div className="my-2 grid gap-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
          <Row label="Final balance" value={fmt(stats.finalBalance)} />
          <Row
            label="Net P&L"
            value={`${stats.pnl >= 0 ? "+" : "−"}${fmt(Math.abs(stats.pnl))}`}
            tone={isProfit ? "bull" : "bear"}
          />
          <Row
            label="Net P&L %"
            value={`${stats.pnlPct >= 0 ? "+" : ""}${stats.pnlPct.toFixed(2)}%`}
            tone={isProfit ? "bull" : "bear"}
          />
          <Row label="Trades" value={String(stats.trades)} />
          <Row
            label="Win rate"
            value={`${stats.winRate.toFixed(1)}%  (${stats.wins}/${stats.trades})`}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await onConfirm();
              onOpenChange(false);
            }}
          >
            <Flag className="mr-2 h-4 w-4" />
            Submit Final
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          tone === "bull"
            ? "text-bull"
            : tone === "bear"
              ? "text-bear"
              : "text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

function fmt(n: number): string {
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
