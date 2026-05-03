"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Hand-rolled section-scoped error boundary. Used as the default boundary
 * around recharts panels, the chart panel on /trade, individual stat
 * cards, and the leaderboard — anywhere a render failure should be
 * contained without killing the surrounding page.
 *
 * Next.js' built-in app/error.tsx is route-level only; this fills the gap
 * for finer-grained recovery.
 */
interface BoundaryProps {
  /** Section name shown in the fallback heading. */
  label: string;
  /** Optional extra context line for the user. */
  hint?: string;
  /** className applied to the outer fallback container. */
  className?: string;
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in dev console; production telemetry lives off-spec for v1.
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          label={this.props.label}
          hint={this.props.hint}
          error={this.state.error}
          onRetry={this.reset}
          className={this.props.className}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Stateless inline fallback. Matches the dashed-card pattern used by empty
 * states so error UI feels intentional, not like a system crash.
 */
export function ErrorFallback({
  label,
  hint,
  error,
  onRetry,
  className,
}: {
  label: string;
  hint?: string;
  error?: Error;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-bear/40 bg-card/30 px-6 py-8 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-bear" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {label} couldn&apos;t render
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {hint ?? error?.message ?? "An unexpected error occurred."}
        </p>
      </div>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RotateCcw className="mr-1.5 h-3 w-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
