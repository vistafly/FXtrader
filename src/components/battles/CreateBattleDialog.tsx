"use client";

// v2.2 — server-backed battle creation modeled on FXReplay's New Battle
// dialog. All new battles are server-backed (multiplayer); the v1 local-
// only path is dropped from the creation surface (existing local battles
// remain readable in the lobby for legacy data continuity).
//
// Field reference per CLAUDE.md §16.1:
//   - Public Match toggle → battles.visibility ("public" | "invite-only")
//   - Duration radios (10/15/30/60 min) → battles.durationMinutes
//   - Profit Target (%) → battles.rules.profitTargetPct (display only;
//     no auto-end on hit; leaderboard surfaces a "target hit" badge)
//   - Account Balance dropdown → battles.startingBalance
//   - Max Participants dropdown → battles.maxParticipants
//   - Available Assets — single-instrument for now; UI shows chip-style
//     to match FXReplay's multi-select look. Multi-asset is BACKLOG.
//   - Max Drawdown / Max Risk per Trade → battles.rules
//
// Deferred per the v2.2 scope split (BACKLOG):
//   - Max Daily Drawdown (needs per-day equity segmentation)
//   - Session Data Length / Historical Data Length (our 30-day bundle
//     doesn't accommodate longer windows)
import { useMutation } from "convex/react";
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
import { buildBattleUrl } from "@/lib/battles/inviteCode";
import { cn } from "@/lib/utils";
import type { Battle } from "@/types/battle";

import { api } from "../../../convex/_generated/api";

const SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "NQ1!", "ES1!"] as const;
const DURATIONS_MIN = [10, 15, 30, 60] as const;
const BALANCES = [10000, 25000, 50000, 100000, 200000] as const;
const PARTICIPANT_LIMITS = [10, 25, 50, 100] as const;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // Retained for backwards compat with v1 lobby reload trigger; v2.2
  // server battles route via window.location instead of fanning back
  // through this callback.
  onCreated?: (battle: Battle) => void;
}

export function CreateBattleDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const createServerBattle = useMutation(api.battles.createBattle);

  const [name, setName] = useState("Custom battle");
  const [publicMatch, setPublicMatch] = useState(false);
  const [durationMin, setDurationMin] = useState<(typeof DURATIONS_MIN)[number]>(10);
  const [profitTarget, setProfitTarget] = useState("");
  const [balance, setBalance] = useState<(typeof BALANCES)[number]>(100000);
  const [maxParticipants, setMaxParticipants] =
    useState<(typeof PARTICIPANT_LIMITS)[number]>(50);
  const [instruments, setInstruments] = useState<string[]>(["EURUSD"]);

  const toggleInstrument = (sym: string) => {
    setInstruments((prev) => {
      if (prev.includes(sym)) {
        // Don't allow removing the last one — battles need >=1 instrument.
        if (prev.length === 1) return prev;
        return prev.filter((s) => s !== sym);
      }
      // Cap at 5 per A4 / FXReplay parity.
      if (prev.length >= 5) return prev;
      return [...prev, sym];
    });
  };
  const [maxDdPct, setMaxDdPct] = useState("");
  const [maxLossPct, setMaxLossPct] = useState("");
  const [requireSl, setRequireSl] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      toast.error("Battle name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const profitTargetPct =
        profitTarget.trim() === "" || Number(profitTarget) <= 0
          ? undefined
          : Number(profitTarget) / 100;
      const battleId = await createServerBattle({
        name,
        instruments,
        startBarTime: 0,
        durationMinutes: durationMin,
        startingBalance: balance,
        maxParticipants,
        rules: {
          maxDrawdownPct:
            maxDdPct.trim() === "" ? undefined : Number(maxDdPct) / 100,
          maxLossPerTradePct:
            maxLossPct.trim() === "" ? undefined : Number(maxLossPct) / 100,
          requireStopLoss: requireSl || undefined,
          profitTargetPct,
        },
        visibility: publicMatch ? "public" : "invite-only",
      });
      toast.success(`Battle "${name}" created.`);
      onOpenChange(false);
      router.push(buildBattleUrl("server", battleId));
    } catch (err) {
      const msg =
        err && typeof err === "object" && "data" in err
          ? String((err as { data: unknown }).data ?? "")
          : err instanceof Error
            ? err.message
            : String(err);
      toast.error(msg || "Could not create battle.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-xl">New Battle</DialogTitle>
          <DialogDescription className="sr-only">
            Configure a new trading battle with rules, instruments, duration,
            and visibility.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-5">
          <Field label="Battle Name *">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={64}
            />
          </Field>

          {/* Public Match toggle — replaces v1's separate Multiplayer +
              visibility controls. v2.2 ships server-only creation.
              `inline-flex items-center` + `shrink-0` keeps the toggle a
              fixed 44×24 inside its flex parent (an earlier `relative
              + absolutely-positioned thumb` layout was getting stretched
              + clipped by the flex container). */}
          <label className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={publicMatch}
              onClick={() => setPublicMatch((v) => !v)}
              className={cn(
                "inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors",
                publicMatch ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform",
                  publicMatch ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
            <span className="text-sm font-medium">Public Match</span>
          </label>
          <p className="-mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {publicMatch
              ? "Listed in the public lobby — anyone can join."
              : "Invite-only — friends need the invite link to join. Battles run for 7 days and can't be deleted."}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duration *">
              <div className="flex flex-wrap gap-3">
                {DURATIONS_MIN.map((m) => (
                  <label
                    key={m}
                    className="flex cursor-pointer items-center gap-1.5 text-sm"
                  >
                    <input
                      type="radio"
                      name="duration"
                      value={m}
                      checked={durationMin === m}
                      onChange={() => setDurationMin(m)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span
                      className={cn(
                        durationMin === m
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {m} min
                    </span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Profit Target (%)" hint="(Optional)">
              <PercentInput
                value={profitTarget}
                onChange={setProfitTarget}
                max={1000}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account Balance *">
              <Select
                value={String(balance)}
                onValueChange={(v) =>
                  setBalance(Number(v) as (typeof BALANCES)[number])
                }
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BALANCES.map((b) => (
                    <SelectItem key={b} value={String(b)}>
                      ${b.toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Max Participants *">
              <Select
                value={String(maxParticipants)}
                onValueChange={(v) =>
                  setMaxParticipants(
                    Number(v) as (typeof PARTICIPANT_LIMITS)[number],
                  )
                }
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARTICIPANT_LIMITS.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Available Assets — chip-style multi-select per FXReplay
              reference. v2.2 schema accepts 1-5 instruments. Trade view
              uses instruments[0] in v2.2 (form-only multi-asset); full
              per-instrument switching during play is v2.2.5. */}
          <Field label="Available Assets *" hint={`(Select 1-5)`}>
            <div className="flex flex-wrap gap-2 rounded-md border border-input bg-background px-3 py-2.5">
              {SYMBOLS.map((s) => {
                const selected = instruments.includes(s);
                const atCap = !selected && instruments.length >= 5;
                const lastOne = selected && instruments.length === 1;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={atCap}
                    onClick={() => toggleInstrument(s)}
                    title={
                      atCap
                        ? "Maximum 5 instruments"
                        : lastOne
                          ? "Battles need at least 1 instrument"
                          : selected
                            ? "Click to remove"
                            : "Click to add"
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-xs transition-colors",
                      selected
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border bg-muted/50 text-muted-foreground hover:bg-muted",
                      atCap && "cursor-not-allowed opacity-50",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {instruments.length}/5 selected
              {instruments.length > 1 && (
                <>
                  {" "}
                  · v2.2 plays the first asset only; full multi-asset is
                  v2.2.5
                </>
              )}
            </p>
          </Field>

          {/* Advanced (rules) — same set as v1 plus the new profitTarget
              already handled above. Max Daily Drawdown is BACKLOG. */}
          <div className="border-t border-border/60 pt-4">
            <p className="mb-3 text-sm font-semibold">Advanced Settings</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Max Drawdown (%)" hint="(Optional)">
                <PercentInput value={maxDdPct} onChange={setMaxDdPct} max={100} />
              </Field>
              <Field label="Max Risk per Trade (%)" hint="(Optional)">
                <PercentInput
                  value={maxLossPct}
                  onChange={setMaxLossPct}
                  max={100}
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
              Back
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Battle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-muted-foreground">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

// Numeric input with a "%" prefix inside the field — visual cue that the
// value is interpreted as a percentage. The % glyph is pointer-events-
// none so clicks pass through to the input.
function PercentInput({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">
        %
      </span>
      <Input
        type="number"
        min={0}
        max={max}
        step="any"
        placeholder="0"
        className="pl-7"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
