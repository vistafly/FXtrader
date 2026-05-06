"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { buildEquityCurve } from "@/lib/analytics/equityCurve";
import { formatMoney } from "@/lib/analytics/stats";
import type { Trade } from "@/types/trade";

export function EquityCurveChart({ trades }: { trades: Trade[] }) {
  const points = buildEquityCurve(trades);

  if (points.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-border/60 bg-card/30 text-sm text-muted-foreground">
        No trades match your filters
      </div>
    );
  }

  // Prepend a (firstTime, 0) anchor so the curve visually starts at zero
  // instead of wherever the first trade landed.
  const data = [
    { time: points[0].time - 1, cumulativePnl: 0, pnlAtPoint: 0, tradesAtPoint: 0 },
    ...points,
  ].map((p) => ({
    ...p,
    label: new Date(p.time * 1000).toISOString().slice(0, 10),
  }));

  const isProfit = points[points.length - 1].cumulativePnl >= 0;
  const stroke = isProfit ? "#16C784" : "#EA3943";

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Equity curve
      </h3>
      <div className="h-[240px] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <LineChart data={data}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              dataKey="label"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              tickFormatter={(v) => formatMoney(Number(v), true)}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(value) => [formatMoney(Number(value), true), "Equity"] as [string, string]}
            />
            <Line
              type="monotone"
              dataKey="cumulativePnl"
              stroke={stroke}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
