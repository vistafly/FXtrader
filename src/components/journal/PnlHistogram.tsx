"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { bucketTradePnls } from "@/lib/analytics/equityCurve";
import { formatMoney } from "@/lib/analytics/stats";
import type { Trade } from "@/types/trade";

export function PnlHistogram({ trades }: { trades: Trade[] }) {
  const buckets = bucketTradePnls(trades, 18);

  if (buckets.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-border/60 bg-card/30 text-sm text-muted-foreground">
        No trades yet
      </div>
    );
  }

  const data = buckets.map((b) => ({
    midLabel: formatMoney(b.mid, true),
    mid: b.mid,
    count: b.count,
    color: b.mid >= 0 ? "#16C784" : "#EA3943",
  }));

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        P&L distribution
      </h3>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="midLabel"
              stroke="hsl(var(--muted-foreground))"
              fontSize={9}
              tickLine={false}
              interval={Math.max(0, Math.floor(data.length / 6) - 1)}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value) => [`${Number(value)} trades`, "Count"] as [string, string]}
              labelFormatter={(label) => `P&L ≈ ${String(label)}`}
            />
            <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
