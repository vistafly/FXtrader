"use client";

import { AlertOctagon, Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Last-resort route-level error boundary. Section-scoped boundaries
 * (components/ErrorFallback.tsx ErrorBoundary class) catch most failures
 * inline; this one catches the rest — provider crashes, routing failures,
 * unrecoverable state.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <AlertOctagon className="h-10 w-10 text-bear" />
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Something broke
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          The app hit an unrecoverable error.
        </h1>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred while rendering this page."}
        </p>
        {error.digest && (
          <p className="font-mono text-[10px] text-muted-foreground">
            digest: {error.digest}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={reset}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        <Button asChild>
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Dashboard
          </Link>
        </Button>
      </div>
    </main>
  );
}
