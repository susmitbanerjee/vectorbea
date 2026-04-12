"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { BeeLogo } from "@/components/brand/bee-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

export function AuthScreen({
  mode,
  next,
}: {
  mode: Mode;
  next?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  const alternateHref = mode === "login" ? "/signup" : "/login";
  const alternateLabel = mode === "login" ? "Create account" : "Sign in instead";

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const authResponse =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            })
          : await supabase.auth.signUp({
              email: email.trim(),
              password,
            });

      if (authResponse.error) {
        throw authResponse.error;
      }

      const accessToken = authResponse.data.session?.access_token;
      if (!accessToken) {
        setInfo(
          "Your account was created. Check your email to confirm your account before continuing.",
        );
        return;
      }

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });

      const payload = (await sessionResponse.json()) as {
        redirectTo?: string;
        error?: string;
      };

      if (!sessionResponse.ok) {
        throw new Error(payload.error || "Failed to establish application session.");
      }

      window.location.assign(next || payload.redirectTo || "/dashboard");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Authentication failed.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="surface-grid min-h-screen bg-gradient-to-br from-background via-background to-muted/40 px-4 py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-5xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="hidden rounded-[2rem] border border-border/60 bg-card/70 p-10 shadow-sm backdrop-blur-sm lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-3 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                <BeeLogo className="h-5 w-5" />
                VectorBea Cloud
              </div>
              <div className="space-y-4">
                <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-foreground">
                  Govern prompts centrally. Keep execution local.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                  Sign in first, then we&apos;ll route you to the right next step:
                  onboarding for a new workspace, billing for enterprise setup, or
                  straight into the dashboard.
                </p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {[
                ["Auth first", "Access and billing state are established before workspace creation."],
                ["Project scoped", "Organizations, workspaces, and RBAC stay aligned from the first session."],
                ["Cloud + sidecar", "Control plane lives in Supabase and Vercel while agents execute locally."],
              ].map(([title, description]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border/60 bg-background/80 p-4"
                >
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-strong rounded-[2rem] p-6 sm:p-8">
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
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {alternateLabel}
              </Link>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
                {mode === "login" ? "Welcome back" : "Create account"}
              </p>
              <h2 className="text-3xl font-semibold tracking-tight">
                {mode === "login" ? "Sign in to continue" : "Start with a secure account"}
              </h2>
              <p className="text-sm leading-7 text-muted-foreground">
                {mode === "login"
                  ? "Use your Supabase credentials to pick up onboarding or jump back into your dashboard."
                  : "Create your account first so we can apply the correct workspace and billing flow immediately after authentication."}
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="email">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground" htmlFor="password">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter a secure password"
                  className="h-11"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !loading) {
                      void submit();
                    }
                  }}
                />
              </div>

              {error && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {info && (
                <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
                  {info}
                </div>
              )}

              <Button
                type="button"
                className={cn(
                  "h-11 w-full text-sm font-semibold",
                  checkingSession && "opacity-80",
                )}
                disabled={loading || checkingSession}
                onClick={() => {
                  void submit();
                }}
              >
                {loading
                  ? mode === "login"
                    ? "Signing in..."
                    : "Creating account..."
                  : mode === "login"
                    ? "Sign in"
                    : "Create account"}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
