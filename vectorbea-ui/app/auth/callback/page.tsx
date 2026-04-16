"use client";

/**
 * OAuth implicit-flow callback.
 *
 * With flowType:"implicit", Supabase delivers the session via the URL hash
 * fragment:  /auth/callback#access_token=...&refresh_token=...
 *
 * createBrowserClient detects the hash automatically and makes the session
 * available via getSession(). We read it here, POST the access_token to
 * /api/auth/set-session so the server can write the httpOnly cookie, then
 * redirect to the appropriate page.
 *
 * Why implicit instead of PKCE?
 * PKCE requires the code_verifier to survive the full OAuth redirect round-trip.
 * @supabase/ssr's createBrowserClient stores it in localStorage which is reset
 * between page navigations in some browsers/environments, making the exchange
 * fail with "PKCE code verifier not found in storage". Implicit flow avoids
 * this entirely — no verifier, no storage dependency.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"pending" | "error">("pending");

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const supabase = getSupabaseBrowserClient();

        // Wait for createBrowserClient to parse the hash and hydrate the session.
        // getSession() returns the session that was embedded in the hash fragment.
        const { data, error } = await supabase.auth.getSession();

        if (error || !data.session) {
          throw new Error(error?.message ?? "No session found after OAuth redirect");
        }

        // Write an httpOnly server cookie so Server Components can authenticate.
        const res = await fetch("/api/auth/set-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });

        if (!res.ok) {
          throw new Error("Failed to persist session cookie");
        }

        if (!cancelled) {
          // Determine post-login destination from the hash's `next` param or default.
          const hashParams = new URLSearchParams(
            window.location.hash.replace("#", "?"),
          );
          const next = hashParams.get("next") ?? "/dashboard";
          router.replace((next.startsWith("/") ? next : "/dashboard") as Route);
        }
      } catch (err) {
        console.error("[auth/callback]", err);
        if (!cancelled) {
          setStatus("error");
          setTimeout(() => router.replace("/login?error=callback_failed" as Route), 2000);
        }
      }
    }

    void finish();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-destructive text-sm">Sign-in failed. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center gap-3">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <p className="text-muted-foreground text-sm">Completing sign in…</p>
    </div>
  );
}
