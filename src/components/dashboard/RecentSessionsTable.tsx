"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatPercent, type SessionPnl } from "@/lib/analytics/stats";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

interface Props {
  sessions: Session[];
  perSessionPnl: SessionPnl[];
}

export function RecentSessionsTable({ sessions, perSessionPnl }: Props) {
  if (sessions.length === 0) return null;
  const pnlBySession = new Map(perSessionPnl.map((p) => [p.sessionId, p]));

  // Show most-recent first.
  const sorted = [...sessions].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Recent sessions
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {sessions.length} total
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Instrument</TableHead>
            <TableHead className="text-right">Realized P&L</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((s) => {
            const p = pnlBySession.get(s.id);
            const pnl = p?.pnl ?? 0;
            const pct = p?.pnlPct ?? 0;
            const accent = pnl >= 0 ? "text-bull" : "text-bear";
            return (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="font-mono text-sm">{s.instrument}</TableCell>
                <TableCell className={cn("text-right font-mono", accent)}>
                  {formatMoney(pnl, true)}
                </TableCell>
                <TableCell className={cn("text-right font-mono", accent)}>
                  {pct >= 0 ? "+" : ""}
                  {formatPercent(pct, 2)}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      s.status === "active" && "bg-primary/15 text-primary",
                      s.status === "ended" && "bg-muted text-muted-foreground",
                      s.status === "paused" && "bg-secondary/15 text-secondary",
                    )}
                  >
                    {s.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="ghost">
                    <Link href={`/trade/${s.id}`}>
                      {s.status === "ended" ? "View" : "Resume"}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
