"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { selectFreeMargin, useSessionStore } from "@/stores/sessionStore";
import { useReplayStore } from "@/stores/replayStore";

interface Props {
  onExit: () => void;
}

const moneyFmt = (n: number) =>
  (n >= 0 ? "$" : "-$") +
  Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AccountSidebar({ onExit }: Props) {
  const session = useSessionStore((s) => s.activeSession);
  const balance = useSessionStore((s) => s.balance);
  const equity = useSessionStore((s) => s.equity);
  const marginUsed = useSessionStore((s) => s.marginUsed);
  const freeMargin = useSessionStore(selectFreeMargin);
  const currentBarTime = useReplayStore((s) => s.currentBarTime);

  if (!session) {
    return (
      <aside className="flex w-[260px] shrink-0 flex-col border-l border-border bg-card/50 p-4 text-sm text-muted-foreground">
        No active session.
      </aside>
    );
  }

  // Total: realized + unrealized — what the account is currently up/down.
  // Unrealized: floating P&L on still-open positions (Eq − Bal).
  // Realized is implicit (Bal − startingBalance) so we don't show it twice.
  const unrealizedPnl = equity - balance;
  const totalPnl = equity - session.startingBalance;
  const totalPnlPct = (totalPnl / session.startingBalance) * 100;

  const stat = (label: string, value: string, accent?: "bull" | "bear" | null) => (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm",
          accent === "bull" && "text-bull",
          accent === "bear" && "text-bear",
        )}
      >
        {value}
      </span>
    </div>
  );

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-l border-border bg-card/50 p-4">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Session</p>
        <p className="truncate text-sm font-semibold text-foreground">{session.name}</p>
        {currentBarTime > 0 && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {new Date(currentBarTime * 1000).toISOString().replace("T", " ").slice(0, 16)} UTC
          </p>
        )}
      </div>

      <div className="grid divide-y divide-border">
        {stat("Balance", moneyFmt(balance))}
        {stat("Equity", moneyFmt(equity))}
        {stat("Margin used", moneyFmt(marginUsed))}
        {stat(
          "Available margin",
          moneyFmt(freeMargin),
          freeMargin < 0 ? "bear" : null,
        )}
        {stat(
          "Unrealized P&L",
          moneyFmt(unrealizedPnl),
          unrealizedPnl >= 0 ? "bull" : "bear",
        )}
        {stat(
          "Total P&L",
          `${moneyFmt(totalPnl)}  (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`,
          totalPnl >= 0 ? "bull" : "bear",
        )}
      </div>

      <div className="mt-auto pt-4">
        <Button
          variant="destructive"
          className="w-full"
          onClick={onExit}
        >
          Exit session
        </Button>
      </div>
    </aside>
  );
}
