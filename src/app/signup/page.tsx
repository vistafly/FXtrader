"use client";

// /signup — full-page signup form.
//
// Three-step flow on a single page:
//   1. User submits email + password + displayName.
//   2. signIn("password", { email, password, flow: "signUp" }) creates the
//      auth user record. After it resolves, useConvexAuth().isAuthenticated
//      flips to true.
//   3. createProfile({ displayName }) writes the profiles row.
//
// If step 3 fails (e.g. taken display name) the user has an auth record but
// no profile. We show the displayName-only form so they can recover without
// re-creating the auth account. The UserMenu's "Set display name" item also
// routes here for the same recovery flow.
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
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
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "@/lib/auth/validation";

import { api } from "../../../convex/_generated/api";

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = validateNextParam(searchParams.get("next"));
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const profile = useQuery(
    api.profiles.getMyProfile,
    isAuthenticated ? {} : "skip",
  );
  const { signIn } = useAuthActions();
  const convex = useConvex();
  const createProfile = useMutation(api.profiles.createProfile);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already fully signed up — bounce to the requested next or /dashboard.
  useEffect(() => {
    if (isAuthenticated && profile) router.replace(next);
  }, [isAuthenticated, profile, next, router]);

  if (isAuthenticated && profile) return null;

  // Authenticated but no profile yet → recovery form.
  const recoveryMode = isAuthenticated && profile === null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Pre-submit validation. The form has noValidate, so we own format checks.
    const displayNameErr = validateDisplayName(displayName);
    if (displayNameErr) {
      toast.error(displayNameErr);
      return;
    }
    const normalizedEmail = recoveryMode ? "" : normalizeEmail(email);
    if (!recoveryMode) {
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
    }

    setSubmitting(true);
    try {
      if (!recoveryMode) {
        // Pre-check: does this email already have an account?
        // @convex-dev/auth's createAccountFromCredentials treats
        // "same email + matching password" as a silent signin (returns
        // existing user, no error). That's confusing UX — user clicks
        // "Create account" and lands on dashboard, looking like a fresh
        // signup. Reject explicitly here so they get a "Try signing in
        // instead" message and a clear next step.
        const taken = await convex.query(api.users.emailExists, {
          email: normalizedEmail,
        });
        if (taken) {
          toast.error(
            "An account with that email already exists. Try signing in instead.",
          );
          setSubmitting(false);
          return;
        }
      }

      if (recoveryMode) {
        // Authed user with no profile (e.g. left over from an earlier
        // failed signup before the server-side flow shipped). Use the
        // explicit createProfile mutation since user creation already
        // happened.
        await createProfile({ displayName });
        toast.success(`Welcome, @${displayName}`);
        // Hard reload so ConvexReactClient re-instantiates from the
        // freshly-set auth cookies; client-side router.replace doesn't
        // always trigger useConvexAuth to re-evaluate.
        window.location.href = next;
      } else {
        // Fresh signup. displayName flows through Password.profile() and
        // is written to the `profiles` table atomically by the
        // afterUserCreatedOrUpdated callback in convex/auth.ts. No
        // separate createProfile call needed (and would race with the
        // WebSocket auth refresh anyway).
        await signIn("password", {
          email: normalizedEmail,
          password,
          displayName,
          flow: "signUp",
        });
        toast.success(`Welcome, @${displayName}`);
        // Hard reload so ConvexReactClient re-instantiates from the
        // freshly-set auth cookies; client-side router.replace doesn't
        // always trigger useConvexAuth to re-evaluate.
        window.location.href = next;
      }
    } catch (err) {
      toast.error(translateAuthError(err, "signUp"));
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
        <div className="h-32 w-full animate-pulse rounded-xl bg-card/40" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Home
      </Link>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {recoveryMode ? "Pick a display name" : "Create an account"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {recoveryMode
            ? "You're signed in but haven't picked a name yet."
            : "Create an account to access your dashboard, journal, and battles."}
        </p>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {!recoveryMode && (
          <>
            <Field label="Email">
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
                // See /signin for the rationale — normalize on paste
                // and blur so the browser's native email validator
                // doesn't reject whitespace before our server-side
                // normalize gets a chance to run.
                onPaste={(e) => {
                  e.preventDefault();
                  setEmail(normalizeEmail(e.clipboardData.getData("text")));
                }}
                onBlur={(e) => setEmail(normalizeEmail(e.target.value))}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                8+ characters. No password reset in v2.0 — write it down.
              </p>
            </Field>
          </>
        )}
        <Field label="Display name">
          <Input
            required
            pattern="[A-Za-z0-9_-]{3,20}"
            placeholder="alice_42"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            3–20 chars: letters, numbers, _ or -. Renamable once per 7 days.
          </p>
        </Field>
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting
            ? "Creating…"
            : recoveryMode
              ? "Set display name"
              : "Create account"}
        </Button>
      </form>

      {!recoveryMode && (
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/signin${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      )}
    </main>
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
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
