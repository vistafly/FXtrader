"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeEmail } from "@/lib/auth/emailNormalize";
import { validateNextParam } from "@/lib/auth/nextParam";
import {
  translateAuthError,
  validateEmail,
  validatePassword,
} from "@/lib/auth/validation";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = validateNextParam(searchParams.get("next"));
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated) router.replace(next);
  }, [isAuthenticated, next, router]);

  if (isAuthenticated) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Pre-submit validation. The form has noValidate, so we own format checks.
    const normalizedEmail = normalizeEmail(email);
    const emailErr = validateEmail(normalizedEmail);
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    const passwordErr = validatePassword(password);
    if (passwordErr) {
      toast.error(passwordErr);
      return;
    }

    setSubmitting(true);
    try {
      await signIn("password", {
        email: normalizedEmail,
        password,
        flow: "signIn",
      });
      // Hard reload (not router.replace) so ConvexReactClient re-instantiates
      // from cookies. With client-side navigation the existing client persists
      // and useConvexAuth doesn't always pick up the freshly-set JWT, leaving
      // the UI in anon state until next manual reload.
      window.location.href = next;
    } catch (err) {
      toast.error(translateAuthError(err, "signIn"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Home
      </Link>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to access your dashboard, journal, and battles.
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Email
          </span>
          <Input
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            // Normalize on paste + blur (not keystroke) so clipboard
            // whitespace and password-manager autofill artifacts get
            // stripped BEFORE the browser's native <input type="email">
            // validator sees them. Without this, " test@x.com " is
            // rejected by the browser pre-submit and our server-side
            // normalize never runs.
            onPaste={(e) => {
              e.preventDefault();
              setEmail(normalizeEmail(e.clipboardData.getData("text")));
            }}
            onBlur={(e) => setEmail(normalizeEmail(e.target.value))}
          />
        </label>
        <label className="block space-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Password
          </span>
          <Input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link
          href={`/signup${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
      <p className="text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Forgot your password? Ask the deployment owner — no reset flow in v2.0.
      </p>
    </main>
  );
}
