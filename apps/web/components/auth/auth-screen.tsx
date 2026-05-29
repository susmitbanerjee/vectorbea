"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2, Shield, Zap, GitBranch, Clock } from "lucide-react";

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

const benefits = [
  "Durable execution timeline for every agent run",
  "Approval gates before high-risk agent actions",
  "Retry and failure recovery with full context",
  "Token and cost budget visibility per run",
  "Complete audit trail for every agent decision",
];

function mapError(value: string | null): string | null {
  if (!value) return null;
  if (value === "oauth" || value === "callback_failed") return "Sign in failed — please try again";
  if (value === "session_expired") return "Session expired — please sign in again";
  return value;
}

// ─── Mock timeline events for the auth preview ────────────────────────────────

const PREVIEW_EVENTS = [
  { type: "RUN_STARTED",        label: "Run started",                       dot: "bg-blue-500",    time: "09:00:01" },
  { type: "AGENT_STARTED",      label: "Orchestrator Agent started",        dot: "bg-violet-500",  time: "09:00:02" },
  { type: "HTTP_CALL_COMPLETED",label: "Usage API returned 128 customers",  dot: "bg-teal-500",    time: "09:00:41" },
  { type: "LLM_CALL_COMPLETED", label: "Risk model · 6,200 tokens",        dot: "bg-purple-500",  time: "09:01:17" },
  { type: "APPROVAL_REQUESTED", label: "Approval gate · CRM update",       dot: "bg-amber-500",   time: "09:01:40" },
  { type: "APPROVAL_APPROVED",  label: "Approved by Demo Owner",            dot: "bg-emerald-500", time: "09:03:18" },
  { type: "ARTIFACT_CREATED",   label: "risk_report.json generated",       dot: "bg-indigo-500",  time: "09:04:02" },
  { type: "RUN_SUCCEEDED",      label: "Run succeeded · $0.061 · 2m 38s",  dot: "bg-emerald-500", time: "09:04:08" },
];

export function AuthScreen({ mode, next }: { mode: Mode; next?: string }) {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(mapError(searchParams.get("error")));
  const [loading, setLoading] = useState<Provider | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [workEmail, setWorkEmail] = useState("");

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

  const callbackNext = next || searchParams.get("next") || undefined;
  const disabled = checkingSession || loading !== null;

  const alternateHref = mode === "signin" ? "/signup" : "/signin";
  const alternateLabel = mode === "signin" ? "Create account" : "Sign in";

  function buildRedirectUrl() {
    const u = new URL("/api/auth/callback", window.location.origin);
    if (callbackNext) u.searchParams.set("next", callbackNext);
    return u;
  }

  async function startOAuth(provider: "github" | "google" | "azure") {
    setLoading(provider);
    setError(null);
    try {
      const route = provider === "github" ? "/api/auth/github" : provider === "google" ? "/api/auth/google" : "/api/auth/microsoft";
      const url = new URL(route, window.location.origin);
      if (callbackNext) url.searchParams.set("next", callbackNext);
      window.location.assign(url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      setLoading(null);
    }
  }

  async function startSso() {
    const domain = workEmail.trim().toLowerCase().split("@")[1]?.trim();
    if (!domain) { setError("Enter a valid work email"); return; }
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
      setError(err instanceof Error ? err.message : "SSO sign in failed");
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">

        {/* ── Left panel — dark infra preview (always dark, explicit light colors) ── */}
        <section className="relative hidden border-r border-white/[0.06] bg-[#050812] lg:flex">
          {/* Subtle grid */}
          <div className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: "linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          {/* Glow */}
          <div className="pointer-events-none absolute left-0 top-0 h-[40%] w-[60%] rounded-full bg-sky-500/5 blur-[80px]" />

          <div className="relative flex h-full w-full flex-col px-10 py-10 xl:px-14 xl:py-12">
            {/* Logo */}
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 shadow-sm">
                <BeeLogo className="h-4 w-4 text-white" />
              </span>
              <span className="text-sm font-semibold tracking-tight text-white/90">Vectorbee</span>
            </Link>

            <div className="my-auto max-w-lg space-y-8">
              {/* Tag */}
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-400/80">
                Production control plane for AI agent jobs
              </p>

              {/* Headline */}
              <h1 className="text-balance text-[2.25rem] font-semibold leading-[1.1] tracking-tight text-white">
                {mode === "signin"
                  ? "Operate AI agent jobs with confidence."
                  : "Start running AI jobs safely."}
              </h1>

              <p className="text-[0.9375rem] leading-7 text-white/60">
                {mode === "signin"
                  ? "Schedule, inspect, retry, and approve long-running AI agent jobs — with complete execution traceability."
                  : "Create your workspace and monitor AI agent automations with approvals, retries, budgets, and audit logs."}
              </p>

              {/* Benefit list */}
              <ul className="space-y-2.5">
                {benefits.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-400/15">
                      <Check className="h-2.5 w-2.5 text-sky-400" />
                    </span>
                    <span className="text-sm leading-6 text-white/60">{item}</span>
                  </li>
                ))}
              </ul>

              {/* Execution timeline preview */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-mono text-[9px] font-semibold uppercase tracking-widest text-white/30">
                    Customer Renewal Intelligence · Run #47
                  </p>
                  <span className="inline-flex items-center gap-1.5 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    SUCCEEDED
                  </span>
                </div>
                <div className="space-y-1.5">
                  {PREVIEW_EVENTS.map((e, i) => (
                    <div key={e.type} className="flex items-center gap-2.5">
                      <div className="flex flex-col items-center">
                        <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", e.dot)} />
                        {i < PREVIEW_EVENTS.length - 1 && <div className="mt-1 h-3 w-px bg-white/10" />}
                      </div>
                      <span className="min-w-[96px] font-mono text-[9px] text-white/25">{e.type}</span>
                      <span className="flex-1 truncate text-[11px] text-white/55">{e.label}</span>
                      <span className="font-mono text-[9px] text-white/25">{e.time}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stat strip */}
              <div className="flex items-center gap-6 border-t border-white/10 pt-5">
                {[
                  { icon: Zap, label: "12,480 tokens" },
                  { icon: Clock, label: "2m 38s duration" },
                  { icon: Shield, label: "1 approval gate" },
                  { icon: GitBranch, label: "5 agents" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <Icon className="h-3 w-3 text-white/25" />
                    <span className="text-[11px] text-white/40">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Right panel — auth form ────────────────────────────────────── */}
        <section className="flex min-h-screen items-center justify-center bg-background px-6 py-10 sm:px-10">
          <div className="w-full max-w-md space-y-6">
            {/* Mobile logo + theme toggle */}
            <div className="flex items-center justify-between lg:justify-end">
              <Link href="/" className="inline-flex items-center gap-2 lg:hidden">
                <BeeLogo className="h-7 w-7" />
                <span className="text-sm font-semibold text-foreground">Vectorbee</span>
              </Link>
              <ThemeToggle />
            </div>

            {/* Form card */}
            <article className="rounded-2xl border border-border bg-card p-7 shadow-panel sm:p-8">
              <div className="space-y-1.5">
                <h2 className="text-[1.375rem] font-semibold tracking-tight text-foreground">
                  {mode === "signin" ? "Sign in to Vectorbee" : "Create your workspace"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {mode === "signin"
                    ? "Your production AI operations control plane"
                    : "Built for teams shipping AI agent jobs into production"}
                </p>
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              {/* SSO / Email */}
              <div className="mt-6 space-y-3">
                <label className="block space-y-1.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Work email</span>
                  <Input
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    placeholder="name@company.com"
                    disabled={disabled}
                    className="h-10 rounded-lg border-border bg-muted/30 text-foreground placeholder:text-muted-foreground/40 focus-visible:border-primary focus-visible:ring-primary/20"
                    onKeyDown={(e) => e.key === "Enter" && void startSso()}
                  />
                </label>

                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void startSso()}
                  className="h-10 w-full justify-between rounded-lg border-border bg-muted/20 text-foreground hover:bg-muted/40"
                >
                  <span className="inline-flex items-center gap-2">
                    <EnterpriseSsoMark className="h-4 w-4 text-muted-foreground" />
                    Continue with SSO
                  </span>
                  {loading === "sso" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">Or continue with</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="space-y-2.5">
                <ProviderButton icon={<GitHubMark className="h-[18px] w-[18px]" />} label="GitHub" loading={loading === "github"} disabled={disabled} onClick={() => void startOAuth("github")} />
                <ProviderButton icon={<GoogleMark className="h-[18px] w-[18px]" />} label="Google" loading={loading === "google"} disabled={disabled} onClick={() => void startOAuth("google")} />
                <ProviderButton icon={<MicrosoftMark className="h-[18px] w-[18px]" />} label="Microsoft" loading={loading === "azure"} disabled={disabled} onClick={() => void startOAuth("azure")} />
              </div>

              <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
                <p>
                  {mode === "signin" ? "No account? " : "Already have an account? "}
                  <Link href={alternateHref} className="font-semibold text-primary hover:text-primary/80">
                    {alternateLabel}
                  </Link>
                </p>
                <Link href={"/docs/security" as never} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                  Privacy
                </Link>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Provider button ──────────────────────────────────────────────────────────

function ProviderButton({ icon, label, loading, disabled, onClick }: {
  icon: React.ReactNode; label: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-lg border border-border bg-muted/20 px-3.5 text-sm font-medium text-foreground",
        "transition-colors hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-50",
      )}
    >
      <span className="inline-flex items-center gap-2.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : icon}
        Continue with {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}
