"use client";

// Handles the OAuth implicit-flow callback.
//
// Supabase redirects here as:
//   /auth/callback#access_token=...&refresh_token=...
//
// The hash fragment is client-side only — no server route can read it, so
// we handle the whole exchange in the browser:
//   1. Let the Supabase browser client parse the hash and store the session.
//   2. POST the access token to /api/auth/session so the server sets its own
//      httpOnly session cookie used by middleware and server components.
//   3. Follow the server's redirectTo decision (onboarding / dashboard).

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const [status, setStatus] = useState("Completing sign-in…");

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const supabase = getSupabaseBrowserClient();

        // Supabase JS reads the hash fragment and hydrates the session.
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          throw error ?? new Error("No session found after OAuth redirect.");
        }

        // Tell the server about the session so it can set the httpOnly cookie.
        const res = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });

        const payload = (await res.json()) as { redirectTo?: string };
        if (!cancelled) {
          window.location.replace(payload.redirectTo ?? "/onboarding");
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : "Authentication failed.";
          setStatus("Sign-in failed. Redirecting…");
          console.error("[auth/callback]", msg);
          setTimeout(() => {
            window.location.replace(`/login?error=oauth`);
          }, 1500);
        }
      }
    }

    void finish();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
        <p className="text-sm text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
