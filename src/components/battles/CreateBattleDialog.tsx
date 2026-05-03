"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { battleRepository } from "@/lib/repository/BattleRepository";
import type { Battle } from "@/types/battle";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "NQ1!", "ES1!"] as const;

let _battleCounter = 0;
const nextBattleId = () =>
  `bt_${Date.now().toString(36)}_${(++_battleCounter).toString(36)}`;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (battle: Battle) => void;
}

export function CreateBattleDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("Custom battle");
  const [instrument, setInstrument] = useState<(typeof SYMBOLS)[number]>("EURUSD");
  const [balance, setBalance] = useState("10000");
  const [durationBars, setDurationBars] = useState("1000");
  const [maxDdPct, setMaxDdPct] = useState(""); // empty = no rule
  const [maxLossPct, setMaxLossPct] = useState("");
  const [requireSl, setRequireSl] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const startingBalance = Number(balance);
    const duration = Number(durationBars);
    if (!Number.isFinite(startingBalance) || startingBalance < 100) {
      toast.error("Starting balance must be at least $100.");
      return;
    }
    if (!Number.isFinite(duration) || duration < 50) {
      toast.error("Duration must be at least 50 bars.");
      return;
    }
    setSubmitting(true);
    try {
      const battle: Battle = {
        id: nextBattleId(),
        name,
        instrument,
        // For Phase 7 the start time is "now-ish" within the bundled data.
        // Actual start-time picker is a Phase 8 polish item.
        startBarTime: 0,
        durationBars: duration,
        startingBalance,
        rules: {
          maxDrawdownPct:
            maxDdPct.trim() === "" ? undefined : Number(maxDdPct) / 100,
          maxLossPerTradePct:
            maxLossPct.trim() === "" ? undefined : Number(maxLossPct) / 100,
          requireStopLoss: requireSl || undefined,
        },
        attempts: [],
      };
      await battleRepository.putBattle(battle);
      toast.success(`Battle "${name}" created.`);
      onOpenChange(false);
      onCreated?.(battle);
    } catch (err) {
      toast.error(`Could not create battle: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create battle</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={64}
            />
          </Field>
          <Field label="Instrument">
            <Select
              value={instrument}
              onValueChange={(v) =>
                setInstrument(v as (typeof SYMBOLS)[number])
              }
            >
              <SelectTrigger className="font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starting balance ($)">
              <Input
                type="number"
                min={100}
                step="any"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                required
              />
            </Field>
            <Field label="Duration (bars)">
              <Input
                type="number"
                min={50}
                step={50}
                value={durationBars}
                onChange={(e) => setDurationBars(e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Battle rules (optional)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max drawdown %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  placeholder="—"
                  value={maxDdPct}
                  onChange={(e) => setMaxDdPct(e.target.value)}
                />
              </Field>
              <Field label="Max loss/trade %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  placeholder="—"
                  value={maxLossPct}
                  onChange={(e) => setMaxLossPct(e.target.value)}
                />
              </Field>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requireSl}
                onChange={(e) => setRequireSl(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>Require a stop loss on every order</span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create battle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
