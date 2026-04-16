"use client";

/**
 * OAuth PKCE callback — client-side exchange.
 *
 * Why client-side?
 * createBrowserClient (@supabase/ssr) stores the PKCE code_verifier in
 * client-side storage (cookie / localStorage). When the OAuth provider
 * redirects back here, browsers may strip cookies that have SameSite=Strict,
 * so a server-side Route Handler cannot reliably read the verifier.
 * Running exchangeCodeForSession() in the browser guarantees the verifier
 * is always accessible, regardless of the SameSite policy.
 *
 * After a successful exchange we POST the raw access_token to
 * /api/auth/set-session, which sets the httpOnly AUTH_COOKIE_NAME cookie
 * that every server component / API route reads for auth.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"pending" | "error">("pending");

  useEffect(() => {
    let cancelled = false;

    async function exchange() {
      const code = searchParams.get("code");
      const next = searchParams.get("next") ?? "/dashboard";

      if (!code) {
        router.replace("/login?error=no_code");
        return;
      }

      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);

        if (error || !data.session) {
          throw new Error(error?.message ?? "Session exchange failed");
        }

        // Persist the access token as a server-readable httpOnly cookie so
        // that getAuthenticatedUserFromCookies() works in Server Components.
        const res = await fetch("/api/auth/set-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: data.session.access_token }),
        });

        if (!res.ok) {
          throw new Error("Failed to persist session cookie");
        }

        if (!cancelled) {
          // Resolve post-login destination — /dashboard or /onboarding
          router.replace(next.startsWith("/") ? next : "/dashboard");
        }
      } catch (err) {
        console.error("[auth/callback]", err);
        if (!cancelled) {
          setStatus("error");
          setTimeout(() => router.replace("/login?error=callback_failed"), 2000);
        }
      }
    }

    void exchange();
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
