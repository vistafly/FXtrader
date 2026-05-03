"use client";

import { ArrowLeft, BookOpen, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ErrorBoundary } from "@/components/ErrorFallback";
import { EquityCurveChart } from "@/components/journal/EquityCurveChart";
import { PnlHistogram } from "@/components/journal/PnlHistogram";
import { TagInput } from "@/components/journal/TagInput";
import { TradeDetailDrawer } from "@/components/journal/TradeDetailDrawer";
import { WinLossPie } from "@/components/journal/WinLossPie";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/analytics/stats";
import { sessionRepository } from "@/lib/repository/SessionRepository";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";
import type { Trade } from "@/types/trade";

type SideFilter = "all" | "buy" | "sell";

export default function JournalPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const [from, setFrom] = useState(""); // ISO yyyy-mm-dd
  const [to, setTo] = useState("");
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [sideFilter, setSideFilter] = useState<SideFilter>("all");
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  const [openTrade, setOpenTrade] = useState<Trade | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [t, s] = await Promise.all([
        tradeRepository.listAll(),
        sessionRepository.list(),
      ]);
      if (!cancelled) {
        setTrades(t);
        setSessions(s);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) for (const tag of t.tags ?? []) set.add(tag);
    return Array.from(set);
  }, [trades]);

  const knownInstruments = useMemo(() => {
    const set = new Set<string>();
    for (const t of trades) set.add(t.instrument);
    return Array.from(set).sort();
  }, [trades]);

  const filtered = useMemo(() => {
    const fromTs = from ? Math.floor(new Date(from).getTime() / 1000) : -Infinity;
    const toTs = to ? Math.floor(new Date(to).getTime() / 1000) + 86_400 : Infinity;
    return trades.filter((t) => {
      if (t.exitTime < fromTs || t.exitTime > toTs) return false;
      if (instrumentFilter !== "all" && t.instrument !== instrumentFilter) return false;
      if (sideFilter !== "all" && t.side !== sideFilter) return false;
      if (tagFilter.length > 0) {
        const tradeTags = t.tags ?? [];
        const hasAll = tagFilter.every((tag) => tradeTags.includes(tag));
        if (!hasAll) return false;
      }
      return true;
    });
  }, [trades, from, to, instrumentFilter, sideFilter, tagFilter]);

  const sortedDesc = useMemo(
    () => [...filtered].sort((a, b) => b.exitTime - a.exitTime),
    [filtered],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-10">
      <header className="space-y-1">
        <Link
          href="/"
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Journal</h1>
        <p className="text-sm text-muted-foreground">
          Equity curve, distributions, and a searchable record of every trade.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card/30 p-4">
        <FilterField label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" />
        </FilterField>
        <FilterField label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" />
        </FilterField>
        <FilterField label="Instrument">
          <Select value={instrumentFilter} onValueChange={setInstrumentFilter}>
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {knownInstruments.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Side">
          <Select value={sideFilter} onValueChange={(v) => setSideFilter(v as SideFilter)}>
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="buy">Long</SelectItem>
              <SelectItem value="sell">Short</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Tags">
          <TagInput
            value={tagFilter}
            onChange={setTagFilter}
            suggestions={knownTags}
            placeholder="Filter…"
          />
        </FilterField>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {filtered.length} of {trades.length} trades
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[240px] animate-pulse rounded-xl bg-card/40" />
          ))}
        </div>
      ) : trades.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
          <BookOpen className="h-8 w-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
              No history yet
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              Your journal will fill in once you close some trades.
            </h2>
          </div>
          <Button asChild>
            <Link href="/">
              <Plus className="mr-2 h-4 w-4" />
              Start a session
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ErrorBoundary label="Equity curve">
                <EquityCurveChart trades={filtered} />
              </ErrorBoundary>
            </div>
            <ErrorBoundary label="Win/loss chart">
              <WinLossPie trades={filtered} />
            </ErrorBoundary>
          </div>
          <ErrorBoundary label="P&L distribution">
            <PnlHistogram trades={filtered} />
          </ErrorBoundary>

          {/* Trade list */}
          <div className="rounded-xl border border-border/80 bg-card/40 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Trades
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">
                Click a row for details
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Closed</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Exit</TableHead>
                  <TableHead className="text-right">P&L</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDesc.map((t) => (
                  <TableRow
                    key={t.id}
                    onClick={() => setOpenTrade(t)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs">
                      {new Date(t.exitTime * 1000).toISOString().slice(0, 16).replace("T", " ")}
                    </TableCell>
                    <TableCell className="font-mono">{t.instrument}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "font-semibold",
                          t.side === "buy" ? "text-bull" : "text-bear",
                        )}
                      >
                        {t.side === "buy" ? "LONG" : "SHORT"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">{t.size}</TableCell>
                    <TableCell className="text-right font-mono">
                      {t.entryPrice}
                    </TableCell>
                    <TableCell className="text-right font-mono">{t.exitPrice}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono",
                        t.pnl >= 0 ? "text-bull" : "text-bear",
                      )}
                    >
                      {formatMoney(t.pnl, true)}
                    </TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">
                      {t.closeReason}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(t.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-border/60 bg-muted/50 px-1.5 py-0 font-mono text-[10px]"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <TradeDetailDrawer
        trade={openTrade}
        onOpenChange={(o) => !o && setOpenTrade(null)}
        onSaved={(updated) => {
          setTrades((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }}
        knownTags={knownTags}
      />

      {/* sessions array imported for type completeness — used when we wire
          per-session navigation in a future polish pass. */}
      <span className="hidden">{sessions.length}</span>
    </main>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
