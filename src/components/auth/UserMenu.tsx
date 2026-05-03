"use client";

// UserMenu — top-right of every page header except /trade/*.
//
// Three states:
//   1. Loading       → render placeholder so layout doesn't jump.
//   2. Anonymous     → "Sign in" button → /signin.
//   3. Authenticated → displayName + dropdown (Sign out).
//
// "Authenticated but no profile" (rare; e.g. signup mid-network-failure
// between auth-create and createProfile) → renders as authenticated with
// "@unset" label and a "Set display name" item that links to /signup.
// /signup detects existing auth and skips straight to the profile form.
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { LogOut, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { api } from "../../../convex/_generated/api";

export function UserMenu() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const profile = useQuery(
    api.profiles.getMyProfile,
    isAuthenticated ? {} : "skip",
  );
  const [signingOut, setSigningOut] = useState(false);

  if (isLoading) {
    return <div className="h-9 w-20 animate-pulse rounded-md bg-card/50" />;
  }

  if (!isAuthenticated) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href="/signin">Sign in</Link>
      </Button>
    );
  }

  const label = profile?.displayName ?? "unset";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-mono">
          <User className="mr-2 h-4 w-4" />@{label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Signed in
        </DropdownMenuLabel>
        {!profile && (
          <DropdownMenuItem asChild>
            <Link href="/signup">Set display name</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onClick={async (e) => {
            e.preventDefault();
            setSigningOut(true);
            try {
              await signOut();
            } finally {
              setSigningOut(false);
            }
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
