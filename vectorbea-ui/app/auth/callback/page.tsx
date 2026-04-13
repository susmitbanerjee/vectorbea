"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logo } from "@/components/ui/Logo";

/**
 * OAuth callback handler.
 *
 * Supabase redirects here after a successful OAuth flow with the access token
 * in the URL *fragment* (hash), e.g.:
 *   /auth/callback#access_token=eyJ...&type=signup
 *
 * Hash fragments are browser-only — they are never sent to the server, so this
 * MUST be a client component. We extract the token, POST it to
 * /api/auth/session (which validates it, creates an httpOnly cookie, and
 * returns the correct redirect destination), then navigate there.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const next = searchParams.get("next") ?? undefined;

    async function handleCallback() {
      // Parse the hash fragment from the current URL.
      const hash = window.location.hash.slice(1); // strip leading '#'
      const params = new URLSearchParams(hash);
      const accessToken = params.get("access_token");
      const errorDescription = params.get("error_description");

      if (errorDescription) {
        router.replace(`/login?error=${encodeURIComponent(errorDescription)}`);
        return;
      }

      if (!accessToken) {
        // No token in hash — maybe a stale/direct visit. Send to login.
        router.replace("/login");
        return;
      }

      try {
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          redirectTo?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Session exchange failed.");
        }

        // Clean the token out of the URL before navigating.
        const destination = next ?? payload.redirectTo ?? "/onboarding";
        window.location.assign(destination);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Authentication failed.";
        router.replace(`/login?error=${encodeURIComponent(message)}`);
      }
    }

    void handleCallback();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <Logo />
      <p className="text-sm text-muted-foreground animate-pulse">
        Completing sign-in…
      </p>
    </div>
  );
}
