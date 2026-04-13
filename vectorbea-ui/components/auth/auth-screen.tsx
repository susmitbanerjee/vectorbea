"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { GitHubMark, GoogleMark } from "@/components/auth/oauth-provider-icons";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup";

export function AuthScreen({
  mode,
  next,
}: {
  mode: Mode;
  next?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [providerLoading, setProviderLoading] = useState<"github" | "google" | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { redirectTo?: string };
        if (!cancelled && payload.redirectTo) {
          window.location.assign(next || payload.redirectTo);
        }
      } finally {
        if (!cancelled) {
          setCheckingSession(false);
        }
      }
    }

    void hydrateSession();

    return () => {
      cancelled = true;
    };
  }, [next]);

  const alternateHref = mode === "signin" ? "/signup" : "/signin";
  const alternateLabel =
    mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in";
  const callbackNext = next || searchParams.get("next") || undefined;

  async function startOAuth(provider: "github" | "google") {
    setProviderLoading(provider);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const redirectUrl = new URL("/auth/callback", window.location.origin);
      if (callbackNext) {
        redirectUrl.searchParams.set("next", callbackNext);
      }

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: redirectUrl.toString(),
          queryParams:
            provider === "google"
              ? { access_type: "offline", prompt: "consent" }
              : undefined,
        },
      });

      if (oauthError) {
        throw oauthError;
      }
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Authentication failed.",
      );
      setProviderLoading(null);
    }
  }

  return (
    <div className="docs-shell-grid min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden rounded-[2rem] border border-border/70 bg-card/95 p-10 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.38)] lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                <BeeLogo className="h-5 w-5" />
                VectorBea Cloud
              </div>
              <div className="space-y-4">
                <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-foreground">
                  Govern prompts centrally. Keep execution local.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                  VectorBea separates the control plane from the customer runtime.
                  Authentication should feel just as direct: identity first, then
                  the right workspace and billing path.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Auth first", "The app decides onboarding, dashboard, or billing only after identity is established."],
                ["Workspace aware", "Profiles, roles, and organizations stay aligned from the first session."],
                ["Cloud + sidecar", "Supabase and Vercel handle governance while customer agents execute locally."],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border/70 bg-background p-4"
                >
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-border/70 bg-card/95 p-6 shadow-[0_24px_80px_-52px_rgba(15,23,42,0.42)] sm:p-8">
            <div className="mb-8 flex items-center justify-between">
              <Link href="/" className="inline-flex items-center gap-3">
                <BeeLogo className="h-10 w-10" />
                <div>
                  <p className="text-sm font-semibold">VectorBea</p>
                  <p className="text-xs text-muted-foreground">Authentication</p>
                </div>
              </Link>
              <Link
                href={alternateHref}
                className="text-sm font-medium text-brand underline-offset-4 hover:underline"
              >
                {alternateLabel}
              </Link>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand">
                {mode === "signin" ? "Sign in" : "Create an account"}
              </p>
              <h2 className="text-3xl font-semibold tracking-tight">
                {mode === "signin" ? "Welcome back" : "Create an account"}
              </h2>
              <p className="text-sm leading-7 text-muted-foreground">
                {mode === "signin"
                  ? "Use your provider account and we’ll route you back to the right workspace automatically."
                  : "Start with OAuth so we can capture your identity and route you into onboarding without any manual data entry."}
              </p>
            </div>

            <div className="mt-8 space-y-4">
              {error ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              ) : null}

              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-14 w-full justify-between rounded-2xl border-border bg-background px-5 text-left text-base font-medium shadow-none hover:bg-accent/40"
                  disabled={checkingSession || providerLoading !== null}
                  onClick={() => void startOAuth("github")}
                >
                  <span className="flex items-center gap-3">
                    <GitHubMark className="h-5 w-5 text-foreground" />
                    Continue with GitHub
                  </span>
                  {providerLoading === "github" ? "Connecting..." : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-14 w-full justify-between rounded-2xl border-border bg-background px-5 text-left text-base font-medium shadow-none hover:bg-accent/40"
                  disabled={checkingSession || providerLoading !== null}
                  onClick={() => void startOAuth("google")}
                >
                  <span className="flex items-center gap-3">
                    <GoogleMark className="h-5 w-5" />
                    Continue with Google
                  </span>
                  {providerLoading === "google" ? "Connecting..." : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-4 text-sm leading-6 text-muted-foreground">
                We capture your name and email from your identity provider, then
                route you into onboarding or back into your workspace automatically.
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
