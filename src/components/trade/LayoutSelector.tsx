"use client";

import { LayoutGrid } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useLayoutStore, type Layout } from "@/stores/layoutStore";

interface LayoutOption {
  value: Layout;
  label: string;
  /** Tiny visual cue: lines spec for an inline grid icon. */
  shape: "1" | "1x2" | "2x1" | "2x2" | "3x2";
}

const OPTIONS: LayoutOption[] = [
  { value: "1pane", label: "Single", shape: "1" },
  { value: "2vertical", label: "Top / Bottom", shape: "1x2" },
  { value: "2horizontal", label: "Left / Right", shape: "2x1" },
  { value: "4quad", label: "4-Quadrant", shape: "2x2" },
  { value: "6pane", label: "6-Pane", shape: "3x2" },
];

/**
 * Inline grid preview — a tiny visual icon showing the layout's pane
 * arrangement. Avoids needing 5 distinct lucide icons.
 */
function LayoutShape({ shape }: { shape: LayoutOption["shape"] }) {
  const cells: { cols: number; rows: number } = {
    "1": { cols: 1, rows: 1 },
    "1x2": { cols: 1, rows: 2 },
    "2x1": { cols: 2, rows: 1 },
    "2x2": { cols: 2, rows: 2 },
    "3x2": { cols: 3, rows: 2 },
  }[shape];
  return (
    <div
      className="grid h-3 w-3 gap-[1px]"
      style={{
        gridTemplateColumns: `repeat(${cells.cols}, 1fr)`,
        gridTemplateRows: `repeat(${cells.rows}, 1fr)`,
      }}
    >
      {Array.from({ length: cells.cols * cells.rows }).map((_, i) => (
        <span
          key={i}
          className="rounded-[1px] border border-current"
        />
      ))}
    </div>
  );
}

/**
 * v2.2.5α: layout selector dropdown. User opts into multi-pane explicitly;
 * single-pane is the default for every battle (regardless of instrument
 * count). Switching layouts rebuilds panes from `availableInstruments`,
 * preserving prior pane state where indices overlap.
 */
export function LayoutSelector({ className }: { className?: string }) {
  const layout = useLayoutStore((s) => s.layout);
  const setLayout = useLayoutStore((s) => s.setLayout);

  const current = OPTIONS.find((o) => o.value === layout) ?? OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:bg-card hover:text-foreground",
          className,
        )}
        aria-label="Choose chart layout"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        <LayoutShape shape={current.shape} />
        <span>{current.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => setLayout(opt.value)}
            className={cn(
              "flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider",
              opt.value === layout && "bg-accent text-foreground",
            )}
          >
            <LayoutShape shape={opt.shape} />
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
