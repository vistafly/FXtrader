"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { Trade } from "@/types/trade";

const COLORS = {
  win: "#16C784",
  loss: "#EA3943",
  breakeven: "#8A8C91",
};

export function WinLossPie({ trades }: { trades: Trade[] }) {
  const wins = trades.filter((t) => t.pnl > 0).length;
  const losses = trades.filter((t) => t.pnl < 0).length;
  const breakevens = trades.length - wins - losses;

  if (trades.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-xl border border-border/60 bg-card/30 text-sm text-muted-foreground">
        No trades yet
      </div>
    );
  }

  const data = [
    { name: "Wins", value: wins, color: COLORS.win },
    { name: "Losses", value: losses, color: COLORS.loss },
    ...(breakevens > 0
      ? [{ name: "Breakeven", value: breakevens, color: COLORS.breakeven }]
      : []),
  ].filter((d) => d.value > 0);

  const winRate = (wins / trades.length) * 100;

  return (
    <div className="rounded-xl border border-border/80 bg-card/40 p-4">
      <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
        Win / loss
      </h3>
      <div className="relative h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              isAnimationActive={false}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} stroke="hsl(var(--card))" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-bold text-foreground">
            {winRate.toFixed(1)}%
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            win rate
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-around font-mono text-[11px] text-muted-foreground">
        <Legend label="W" count={wins} color={COLORS.win} />
        <Legend label="L" count={losses} color={COLORS.loss} />
        {breakevens > 0 && <Legend label="BE" count={breakevens} color={COLORS.breakeven} />}
      </div>
    </div>
  );
}

function Legend({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: color }}
      />
      {label} {count}
    </span>
  );
}
