"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import {
  EnterpriseSsoMark,
  GitHubMark,
  GoogleMark,
  MicrosoftMark,
} from "@/components/auth/oauth-provider-icons";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup";
type Provider = "github" | "google" | "azure" | "sso";

const TRUST_ITEMS = [
  "Detect regressions before users notice",
  "Block unsafe rollouts with evaluation gates",
  "Model calls and audit events stay in your VPC",
  "Immutable log of every AI decision and operator action",
];

export function AuthScreen({ mode, next }: { mode: Mode; next?: string }) {
  const searchParams = useSearchParams();
  const rawError = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    rawError === "oauth" || rawError === "callback_failed"
      ? "Sign-in failed. Please try again or use a different provider."
      : rawError === "session_expired"
      ? "Your session expired. Please sign in again."
      : rawError ?? null,
  );
  const [loading, setLoading] = useState<Provider | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [ssoEmail, setSsoEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function hydrateSession() {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return;
        const payload = (await res.json()) as { redirectTo?: string };
        if (!cancelled && payload.redirectTo) {
          const dest = next && next !== "/" ? next : payload.redirectTo;
          window.location.assign(dest);
        }
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    }
    void hydrateSession();
    return () => { cancelled = true; };
  }, [next]);

  const alternateHref  = mode === "signin" ? "/signup" : "/signin";
  const alternateLabel = mode === "signin" ? "Create account" : "Sign in";
  const callbackNext   = next || searchParams.get("next") || undefined;

  function buildRedirectUrl() {
    const u = new URL("/api/auth/callback", window.location.origin);
    if (callbackNext) u.searchParams.set("next", callbackNext);
    return u;
  }

  async function startOAuth(provider: "github" | "google" | "azure") {
    setLoading(provider);
    setError(null);
    try {
      const route = provider === "github" ? "/api/auth/github"
                  : provider === "google" ? "/api/auth/google"
                  : "/api/auth/microsoft";
      const url = new URL(route, window.location.origin);
      if (callbackNext) url.searchParams.set("next", callbackNext);
      window.location.assign(url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      setLoading(null);
    }
  }

  async function startSso() {
    const domain = ssoEmail.trim().toLowerCase().split("@")[1]?.trim();
    if (!domain) { setError("Enter a valid work email."); return; }
    setLoading("sso");
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: ssoError } = await supabase.auth.signInWithSSO({
        domain,
        options: { redirectTo: buildRedirectUrl().toString() },
      });
      if (ssoError) throw ssoError;
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO failed. Check with your IT admin.");
      setLoading(null);
    }
  }

  const disabled = checkingSession || loading !== null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_520px]">

        {/* ── Left: brand panel ─────────────────────────────────────────── */}
        <section className="relative hidden lg:flex flex-col border-r border-border/50">
          {/* Background */}
          <div className="absolute inset-0 bg-muted/25" />
          <div className="absolute inset-0 surface-grid opacity-60" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_0%_40%,hsl(var(--primary)/0.08),transparent_65%)]" />

          <div className="relative flex h-full flex-col px-12 py-10 xl:px-16 xl:py-12">
            {/* Logo */}
            <Link href="/" className="inline-flex items-center gap-3 group w-fit">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background shadow-sm group-hover:border-primary/30 transition-colors">
                <BeeLogo className="h-4 w-4" />
              </div>
              <span className="text-sm font-semibold tracking-tight">VectorBea</span>
            </Link>

            {/* Hero copy — vertically centered */}
            <div className="flex flex-1 flex-col justify-center max-w-lg space-y-10">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  AI Risk Control for Production LLMs
                </p>
                <h1 className="text-[2.75rem] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground xl:text-5xl">
                  Prevent bad AI outputs.{" "}
                  <span className="text-muted-foreground">Before they reach production.</span>
                </h1>
                <p className="text-base leading-7 text-muted-foreground">
                  Control prompt behavior, detect regressions, block unsafe rollouts,
                  and audit every AI decision — all from one control plane.
                </p>
              </div>

              {/* Trust checklist */}
              <ul className="space-y-3">
                {TRUST_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Check className="h-3 w-3 text-primary" strokeWidth={2.5} />
                    </span>
                    <span className="text-sm leading-6 text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>

              {/* Stat strip */}
              <div className="grid grid-cols-3 gap-3 pt-2">
                {[
                  ["8 ms", "P99 prompt latency"],
                  ["0", "inbound ports"],
                  ["100%", "data residency"],
                ].map(([val, label]) => (
                  <div key={label} className="rounded-xl border border-border/60 bg-card/80 p-4">
                    <p className="text-2xl font-semibold tracking-tight text-foreground">{val}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <p className="text-xs text-muted-foreground/50">
              © {new Date().getFullYear()} VectorBea. Privacy-first by design.
            </p>
          </div>
        </section>

        {/* ── Right: auth form ───────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10 sm:px-10">
          {/* Mobile header */}
          <div className="mb-8 flex w-full max-w-sm items-center justify-between lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2">
              <BeeLogo className="h-7 w-7" />
              <span className="text-sm font-semibold">VectorBea</span>
            </Link>
            <ThemeToggle />
          </div>

          <div className="w-full max-w-sm space-y-8">
            {/* Desktop theme toggle */}
            <div className="hidden lg:flex justify-end">
              <ThemeToggle />
            </div>

            {/* Heading */}
            <div className="space-y-1">
              <h2 className="text-2xl font-semibold tracking-tight">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Sign in to continue to your workspace."
                  : "Get started — no credit card required."}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* OAuth providers */}
            <div className="space-y-3">
              <ProviderButton
                icon={<GitHubMark className="h-[18px] w-[18px]" />}
                label="Continue with GitHub"
                loading={loading === "github"}
                disabled={disabled}
                onClick={() => void startOAuth("github")}
              />
              <ProviderButton
                icon={<GoogleMark className="h-[18px] w-[18px]" />}
                label="Continue with Google"
                loading={loading === "google"}
                disabled={disabled}
                onClick={() => void startOAuth("google")}
              />
              <ProviderButton
                icon={<MicrosoftMark className="h-[18px] w-[18px]" />}
                label="Continue with Microsoft"
                loading={loading === "azure"}
                disabled={disabled}
                onClick={() => void startOAuth("azure")}
              />
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-3 text-xs text-muted-foreground">
                  Enterprise SSO
                </span>
              </div>
            </div>

            {/* SSO */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <EnterpriseSsoMark className="h-4 w-4 text-muted-foreground" />
                Sign in with your identity provider
              </div>
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={ssoEmail}
                  onChange={(e) => setSsoEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-10 flex-1 rounded-lg bg-background text-sm"
                  disabled={disabled}
                  onKeyDown={(e) => e.key === "Enter" && void startSso()}
                />
                <Button
                  variant="outline"
                  className="h-10 shrink-0 rounded-lg text-sm"
                  disabled={disabled}
                  onClick={() => void startSso()}
                >
                  {loading === "sso" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue"}
                </Button>
              </div>
            </div>

            {/* Footer links */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <p>
                {mode === "signin" ? "No account?" : "Already have one?"}{" "}
                <Link href={alternateHref} className="font-medium text-primary hover:underline underline-offset-4">
                  {alternateLabel}
                </Link>
              </p>
              <Link href="/docs/security" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

/* ── Provider button ─────────────────────────────────────────────────────── */
function ProviderButton({
  icon, label, loading, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative flex h-11 w-full items-center gap-3 rounded-lg border border-border/70 bg-background px-4",
        "text-sm font-medium text-foreground",
        "transition-all duration-150",
        "hover:bg-muted/50 hover:border-border hover:-translate-y-px hover:shadow-sm",
        "active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : icon}
      </span>
      <span className="flex-1 text-left">{loading ? "Connecting…" : label}</span>
      {!loading && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
    </button>
  );
}