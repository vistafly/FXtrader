"use client";

import { Shield } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Battle } from "@/types/battle";

interface Props {
  rules: Battle["rules"] | undefined;
  className?: string;
}

/**
 * v2.3 sub-phase 2B (early intro of sub-phase 6 work): compact
 * read-only display of the active battle's rules. Renders a small
 * chip cluster — one chip per active rule — anchored next to the
 * session-name in the trade-page header so the user has them
 * visible while trading.
 *
 * Renders nothing when no rules are configured (`undefined` or all
 * fields empty). Rules with `requireStopLoss: false` and
 * `profitTargetPct` only (display-only, not enforced) still render
 * their chip so the user sees the full attempt context.
 */
export function RulesChips({ rules, className }: Props) {
  if (!rules) return null;
  const chips: Array<{ label: string; tone: "default" | "warn" | "good" }> = [];
  if (typeof rules.maxDrawdownPct === "number") {
    chips.push({
      label: `Max DD ${rules.maxDrawdownPct}%`,
      tone: "warn",
    });
  }
  if (typeof rules.maxLossPerTradePct === "number") {
    chips.push({
      label: `Max loss/trade ${rules.maxLossPerTradePct}%`,
      tone: "warn",
    });
  }
  if (rules.requireStopLoss) {
    chips.push({ label: "SL required", tone: "warn" });
  }
  if (typeof rules.profitTargetPct === "number") {
    chips.push({
      label: `Target +${rules.profitTargetPct}%`,
      tone: "good",
    });
  }
  if (chips.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider",
        className,
      )}
      aria-label="Battle rules"
    >
      <Shield className="h-3 w-3 text-muted-foreground" aria-hidden />
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn(
            "rounded border px-1.5 py-0.5",
            c.tone === "warn" &&
              "border-bear/40 bg-bear/10 text-bear",
            c.tone === "good" &&
              "border-bull/40 bg-bull/10 text-bull",
            c.tone === "default" && "border-border/50 text-muted-foreground",
          )}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}
