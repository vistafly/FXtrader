"use client";

import { useState } from "react";

import { TagInput } from "@/components/journal/TagInput";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/analytics/stats";
import { tradeRepository } from "@/lib/repository/TradeRepository";
import { cn } from "@/lib/utils";
import type { Trade } from "@/types/trade";

interface Props {
  trade: Trade | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (trade: Trade) => void;
  /** All tags from all trades — drives autocomplete suggestions. */
  knownTags: string[];
}

/**
 * Right-drawer detail view for a single closed trade. Outer wrapper drives
 * the Sheet's open/close; the inner panel is keyed by trade.id so React
 * remounts it (and thus resets local notes/tags state) when the user
 * opens a different trade — no setState-in-effect needed.
 */
export function TradeDetailDrawer({ trade, onOpenChange, onSaved, knownTags }: Props) {
  const open = trade !== null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[400px] flex-col gap-4 sm:max-w-[400px]">
        <SheetHeader>
          <SheetTitle>Trade detail</SheetTitle>
        </SheetHeader>
        {trade && (
          <DrawerBody
            key={trade.id}
            trade={trade}
            knownTags={knownTags}
            onSaved={onSaved}
            onOpenChange={onOpenChange}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  trade,
  knownTags,
  onSaved,
  onOpenChange,
}: {
  trade: Trade;
  knownTags: string[];
  onSaved?: (trade: Trade) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [notes, setNotes] = useState(trade.notes ?? "");
  const [tags, setTags] = useState<string[]>(trade.tags ?? []);
  const [saving, setSaving] = useState(false);
  const dirty =
    notes !== (trade.notes ?? "") ||
    JSON.stringify(tags) !== JSON.stringify(trade.tags ?? []);

  const onSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const updated: Trade = { ...trade, notes, tags };
      await tradeRepository.add(updated);
      onSaved?.(updated);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
              <Stat label="Asset" value={trade.instrument} />
              <Stat label="Side" value={trade.side === "buy" ? "LONG" : "SHORT"} />
              <Stat label="Size" value={trade.size.toString()} />
              <Stat label="Reason" value={trade.closeReason} />
              <Stat label="Entry" value={trade.entryPrice.toString()} />
              <Stat label="Exit" value={trade.exitPrice.toString()} />
              <Stat label="Pips" value={formatPercent(trade.pips / 10000, 1)} />
              <Stat
                label="P&L"
                value={formatMoney(trade.pnl, true)}
                accent={trade.pnl >= 0 ? "bull" : "bear"}
              />
            </div>

            <div className="grid gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="What was your thesis? What worked, what didn't?"
                className="resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="grid gap-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                Tags
              </label>
              <TagInput
                value={tags}
                onChange={setTags}
                suggestions={knownTags}
              />
            </div>

      <div className="mt-auto flex items-center justify-end gap-2 pt-3">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button onClick={onSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "bull" | "bear";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono",
          accent === "bull" && "text-bull",
          accent === "bear" && "text-bear",
        )}
      >
        {value}
      </span>
    </div>
  );
}
