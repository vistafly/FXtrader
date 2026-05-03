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
import { ConvexError } from "convex/values";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { api } from "../../../convex/_generated/api";

export default function SignUpPage() {
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const profile = useQuery(
    api.profiles.getMyProfile,
    isAuthenticated ? {} : "skip",
  );
  const { signIn } = useAuthActions();
  const createProfile = useMutation(api.profiles.createProfile);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already fully signed up — bounce home.
  if (isAuthenticated && profile) {
    router.replace("/");
    return null;
  }

  // Authenticated but no profile yet → recovery form.
  const recoveryMode = isAuthenticated && profile === null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      if (!recoveryMode) {
        // Fresh signup: create auth user first.
        await signIn("password", { email, password, flow: "signUp" });
      }
      try {
        await createProfile({ displayName });
        toast.success(`Welcome, @${displayName}`);
        router.replace("/");
      } catch (err) {
        // Auth created but profile creation failed (likely taken name).
        // Stay on /signup in recovery mode so they can pick a new name
        // without re-creating the auth row.
        const msg =
          err instanceof ConvexError
            ? String(err.data ?? "Couldn't set display name")
            : err instanceof Error
              ? err.message
              : "Couldn't set display name";
        toast.error(msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-up failed";
      toast.error(msg);
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
        <ArrowLeft className="h-3 w-3" /> Dashboard
      </Link>
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {recoveryMode ? "Pick a display name" : "Create an account"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {recoveryMode
            ? "You're signed in but haven't picked a name yet."
            : "Sign up to join multiplayer battles. Single-player still works without an account."}
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        {!recoveryMode && (
          <>
            <Field label="Email">
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
          <Link href="/signin" className="text-primary hover:underline">
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
