"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";

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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The battle's display name. The user must type this verbatim to enable Confirm. */
  battleName: string;
  /** Fires only after the user types the battle name correctly and confirms. */
  onConfirm: () => Promise<void> | void;
}

/**
 * v2.3 sub-phase 2B (D2 refinement): destructive abandon-attempt
 * confirmation. The user types the battle name verbatim before
 * the Confirm button enables.
 *
 * Why typing-friction over checkbox-style "are you sure?":
 *   - Click-through modals get reflexively dismissed
 *   - Abandoning a competitive attempt is real data loss (the
 *     accumulated trades, current balance, etc. all disappear)
 *   - Typing the name is high-effort enough that it can't be
 *     muscle-memory accidentally
 *
 * Comparison is exact (case + whitespace), not normalized — the
 * goal is friction, not convenience.
 */
export function AbandonAttemptDialog({
  open,
  onOpenChange,
  battleName,
  onConfirm,
}: Props) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset the input on each open transition by keying the input
  // (instead of a setState-in-effect, which would trip the React 19
  // immutability lint). Sister components in the codebase use the
  // same pattern. The fragment of state that needs to be reset on
  // close is just the typed string + submitting flag; clearing them
  // when the dialog closes keeps the input pristine on re-open.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTyped("");
      setSubmitting(false);
    }
    onOpenChange(next);
  };

  const matches = typed === battleName;

  const onSubmit = async () => {
    if (!matches || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
      handleOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Abandon attempt?
          </DialogTitle>
          <DialogDescription>
            This permanently throws away your in-flight attempt — every trade,
            the current balance, the time you&apos;ve spent. The leaderboard
            row will not be created. To confirm, type the battle name below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <label
            htmlFor="abandon-confirm"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Battle name
          </label>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-sm">
            {battleName}
          </p>
          <Input
            id="abandon-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type to confirm"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches && !submitting) {
                e.preventDefault();
                void onSubmit();
              }
            }}
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={!matches || submitting}
          >
            {submitting ? "Abandoning…" : "Abandon attempt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
