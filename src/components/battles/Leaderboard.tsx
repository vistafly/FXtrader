"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Crown, ShieldX } from "lucide-react";
import { useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/analytics/stats";
import { rankAttempts } from "@/lib/battles/leaderboard";
import { cn } from "@/lib/utils";
import type { BattleAttempt } from "@/types/battle";

interface RankedAttempt extends BattleAttempt {
  rank: number;
}

interface Props {
  attempts: BattleAttempt[];
}

/**
 * Sortable, DQ-aware leaderboard. Default sort = pnlPct descending (the
 * canonical leaderboard order, matching `rankAttempts`). Disqualified
 * attempts are listed below the ranked rows in a separate group, never
 * mixed in.
 */
export function Leaderboard({ attempts }: Props) {
  const ranked: RankedAttempt[] = rankAttempts(attempts).map((a, i) => ({
    ...a,
    rank: i + 1,
  }));
  const dq = attempts.filter((a) => a.disqualified);

  const [sorting, setSorting] = useState<SortingState>([
    { id: "pnlPct", desc: true },
  ]);

  const columns: ColumnDef<RankedAttempt>[] = [
    {
      accessorKey: "rank",
      header: "#",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.rank === 1 && <Crown className="mr-1 inline h-3 w-3 text-bull" />}
          {row.original.rank}
        </span>
      ),
    },
    {
      accessorKey: "pnlPct",
      header: "P&L %",
      cell: ({ row }) => (
        <span
          className={cn(
            "font-mono",
            row.original.pnlPct >= 0 ? "text-bull" : "text-bear",
          )}
        >
          {row.original.pnlPct >= 0 ? "+" : ""}
          {formatPercent(row.original.pnlPct, 2)}
        </span>
      ),
    },
    {
      accessorKey: "finalBalance",
      header: "Final balance",
      cell: ({ row }) => (
        <span className="font-mono">{formatMoney(row.original.finalBalance)}</span>
      ),
    },
    {
      accessorKey: "trades",
      header: "Trades",
    },
    {
      accessorKey: "winRate",
      header: "Win rate",
      cell: ({ row }) => formatPercent(row.original.winRate, 1),
    },
    {
      accessorKey: "completedAt",
      header: "Completed",
      cell: ({ row }) =>
        new Date(row.original.completedAt * 1000).toISOString().slice(0, 10),
    },
  ];

  // TanStack Table returns fresh functions per render; React Compiler can't
  // memoize safely. The behavior is intentional — sorting state changes
  // drive the re-render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: ranked,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Leaderboard
        </h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {ranked.length} ranked
          {dq.length > 0 && <> · {dq.length} disqualified</>}
        </span>
      </div>

      {ranked.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
          No ranked attempts yet — be the first.
        </div>
      ) : (
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : (
                      <button
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex items-center gap-1 transition-colors",
                          h.column.getCanSort() && "hover:text-foreground",
                        )}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === "asc" && (
                          <ArrowUp className="h-3 w-3" />
                        )}
                        {h.column.getIsSorted() === "desc" && (
                          <ArrowDown className="h-3 w-3" />
                        )}
                        {h.column.getCanSort() && !h.column.getIsSorted() && (
                          <ChevronsUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dq.length > 0 && (
        <div className="border-t border-border/60 px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-bear">
            <ShieldX className="h-3 w-3" />
            <span>Disqualified ({dq.length})</span>
          </div>
          <ul className="space-y-1 text-xs">
            {dq.map((a) => (
              <li
                key={a.id}
                className="flex items-baseline justify-between gap-3 text-muted-foreground"
              >
                <span className="truncate">
                  {a.disqualificationReason ?? "Disqualified"}
                </span>
                <span className="font-mono">
                  {a.pnlPct >= 0 ? "+" : ""}
                  {formatPercent(a.pnlPct, 2)} ·{" "}
                  {new Date(a.completedAt * 1000).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
