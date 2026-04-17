"use client";

/**
 * Legacy implicit-flow callback page — no longer active.
 *
 * The OAuth redirect URI now points to the server-side Route Handler at
 * /api/auth/callback which performs the PKCE exchange and sets cookies
 * without any client-side JavaScript.
 *
 * This page is kept only as a safety net: if a user somehow lands here
 * (e.g. a cached bookmark from before the PKCE migration), we redirect
 * them to the login page instead of leaving them on a blank screen.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

export default function LegacyAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login" as Route);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-3">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <p className="text-muted-foreground text-sm">Redirecting…</p>
    </div>
  );
}
