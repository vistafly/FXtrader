"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useOrderStore } from "@/stores/orderStore";
import { useSessionStore } from "@/stores/sessionStore";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "NQ1!", "ES1!"] as const;

export function NewSessionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("Practice run");
  const [instrument, setInstrument] = useState<(typeof SYMBOLS)[number]>("EURUSD");
  // Track the raw input string so users can clear and retype freely. We parse
  // and validate on submit, not on every keystroke (which would lock the input
  // to a min-clamped value).
  const [balanceText, setBalanceText] = useState("10000");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const balance = Number(balanceText);
    if (!Number.isFinite(balance) || balance < 100) {
      toast.error("Starting balance must be at least $100.");
      return;
    }
    setSubmitting(true);
    try {
      useOrderStore.getState().resetForSession();
      const session = await useSessionStore.getState().startSession({
        name,
        instrument,
        startBarTime: 0,
        startingBalance: balance,
      });
      onOpenChange(false);
      router.push(`/trade/${session.id}`);
    } catch (err) {
      toast.error(`Could not start session: ${(err as Error).message}`);
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a new session</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an instrument, starting balance, and start time for a new
            replay session.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={64}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Instrument</span>
            <Select value={instrument} onValueChange={(v) => setInstrument(v as (typeof SYMBOLS)[number])}>
              <SelectTrigger className="font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Starting balance (USD)</span>
            <Input
              type="number"
              min={100}
              step="any"
              value={balanceText}
              onChange={(e) => setBalanceText(e.target.value)}
              placeholder="10000"
              required
            />
          </label>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Starting…" : "Start session"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
