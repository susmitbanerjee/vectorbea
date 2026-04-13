"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { GitHubMark, GoogleMark } from "@/components/auth/oauth-provider-icons";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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
  const searchParams = useSearchParams();
  const rawError = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    rawError === "oauth"
      ? "Authentication failed. Please try again."
      : rawError ?? null,
  );
  const [providerLoading, setProviderLoading] = useState<"github" | "google" | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

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
          // Only use `next` if it's a meaningful app path, not the root.
          const destination = (next && next !== "/") ? next : payload.redirectTo;
          window.location.assign(destination);
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-2">
        <section className="relative hidden border-r border-border/80 bg-muted/30 lg:flex">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,128,255,0.14),transparent_42%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.1),transparent_42%)]" />
          <div className="relative flex w-full flex-col justify-between px-12 py-10 xl:px-16 xl:py-12">
            <div className="flex items-center justify-between">
              <Link href="/" className="inline-flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-card shadow-sm">
                  <BeeLogo className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight">VectorBea</p>
                  <p className="text-xs text-muted-foreground">Enterprise prompt operations</p>
                </div>
              </Link>
              <ThemeToggle />
            </div>

            <div className="max-w-xl space-y-8">
              <div className="space-y-5">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                  Govern prompts. Keep execution local.
                </p>
                <h1 className="text-5xl font-semibold tracking-tight text-foreground xl:text-6xl">
                  The control plane your AI stack has been missing.
                </h1>
                <p className="text-lg leading-8 text-muted-foreground">
                  VectorBea gives teams a clean place to manage prompts, routing,
                  billing, and telemetry while agents and model calls continue to
                  run inside the customer environment.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  "Authentication happens before workspace creation.",
                  "Free plan onboarding is immediate and self-serve.",
                  "Projects stay isolated through role-aware boundaries.",
                  "Control plane syncs over outbound HTTPS only.",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card/90 p-4"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-brand" />
                    <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["1 identity flow", "GitHub or Google first, then route users cleanly."],
                ["2 surfaces", "Control plane in cloud, execution in customer infra."],
                ["0 ambiguity", "Clear next steps for onboarding, billing, and dashboard access."],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border/70 bg-background/85 p-4"
                >
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-8 lg:px-12 xl:px-16">
          <div className="w-full max-w-xl">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" className="inline-flex items-center gap-3">
                <BeeLogo className="h-9 w-9" />
                <div>
                  <p className="text-sm font-semibold">VectorBea</p>
                  <p className="text-xs text-muted-foreground">Authentication</p>
                </div>
              </Link>
              <ThemeToggle />
            </div>

            <div className="rounded-[2rem] border border-border/80 bg-card/98 p-8 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.42)] sm:p-10">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                    {mode === "signin" ? "Sign in" : "Create account"}
                  </p>
                  <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                    {mode === "signin" ? "Welcome back" : "Create an account"}
                  </h2>
                  <p className="max-w-md text-sm leading-7 text-muted-foreground">
                    {mode === "signin"
                      ? "Use your provider account and we will route you back into the correct workspace automatically."
                      : "Start with OAuth and we will capture your identity, persist your profile, and send you straight into onboarding."}
                  </p>
                </div>
                <Link
                  href={alternateHref}
                  className="hidden text-sm font-medium text-brand underline-offset-4 hover:underline sm:block"
                >
                  {alternateLabel}
                </Link>
              </div>

              <div className="mt-8 space-y-4">
                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="h-16 w-full justify-between rounded-2xl border-border/80 bg-background px-5 text-left text-base font-medium shadow-none hover:bg-accent/40"
                  disabled={checkingSession || providerLoading !== null}
                  onClick={() => void startOAuth("github")}
                >
                  <span className="flex items-center gap-3">
                    <GitHubMark className="h-5 w-5 text-foreground" />
                    Continue with GitHub
                  </span>
                  {providerLoading === "github" ? (
                    "Connecting..."
                  ) : (
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-16 w-full justify-between rounded-2xl border-border/80 bg-background px-5 text-left text-base font-medium shadow-none hover:bg-accent/40"
                  disabled={checkingSession || providerLoading !== null}
                  onClick={() => void startOAuth("google")}
                >
                  <span className="flex items-center gap-3">
                    <GoogleMark className="h-5 w-5" />
                    Continue with Google
                  </span>
                  {providerLoading === "google" ? (
                    "Connecting..."
                  ) : (
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>

              <div className="mt-6 rounded-2xl border border-border/70 bg-muted/30 px-4 py-4 text-sm leading-6 text-muted-foreground">
                We capture your full name and email from the provider so your
                profile, billing flow, and workspace onboarding stay in sync from
                the first session.
              </div>

              <div className="mt-6 sm:hidden">
                <Link
                  href={alternateHref}
                  className="text-sm font-medium text-brand underline-offset-4 hover:underline"
                >
                  {alternateLabel}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
