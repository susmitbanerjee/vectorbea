"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Loader2, Shield, Zap, GitBranch, Clock, ChevronRight } from "lucide-react";

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

// ─── Left panel — fixed dark theme ───────────────────────────────────────────

const PREVIEW_EVENTS = [
  { type: "RUN_STARTED",         label: "Run started",                        dot: "bg-blue-500",    time: "09:00:01" },
  { type: "AGENT_STARTED",       label: "Orchestrator Agent started",         dot: "bg-violet-500",  time: "09:00:02" },
  { type: "HTTP_CALL_COMPLETED", label: "Usage API returned 128 customers",   dot: "bg-teal-500",    time: "09:00:41" },
  { type: "LLM_CALL_COMPLETED",  label: "Risk model · 6,200 tokens",         dot: "bg-purple-500",  time: "09:01:17" },
  { type: "APPROVAL_REQUESTED",  label: "Approval gate · CRM update",        dot: "bg-amber-500",   time: "09:01:40" },
  { type: "APPROVAL_APPROVED",   label: "Approved by Demo Owner",             dot: "bg-emerald-500", time: "09:03:18" },
  { type: "ARTIFACT_CREATED",    label: "risk_report.json generated",        dot: "bg-indigo-500",  time: "09:04:02" },
  { type: "RUN_SUCCEEDED",       label: "Run succeeded · $0.061 · 2m 38s",   dot: "bg-emerald-500", time: "09:04:08" },
];

const BENEFITS = [
  "Durable execution timeline for every agent run",
  "Approval gates before high-risk agent actions",
  "Retry and failure recovery with full context",
  "Token and cost budget visibility per run",
  "Complete audit trail for every agent decision",
];

// ─── Error mapping (unchanged) ────────────────────────────────────────────────

function mapError(value: string | null): string | null {
  if (!value) return null;
  if (value === "oauth" || value === "callback_failed") return "Sign in failed — please try again";
  if (value === "session_expired") return "Session expired — please sign in again";
  return value;
}

// ─── Auth screen ─────────────────────────────────────────────────────────────

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
  const alternateLabel = mode === "signin" ? "Create account" : "Sign in instead";

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
      <div className="grid min-h-screen lg:grid-cols-[1fr_460px]">

        {/* ── Left — dark feature panel ─────────────────────────────────── */}
        <section className="relative hidden overflow-hidden bg-[#040710] lg:flex"
          style={{ borderRight: "1px solid rgba(148,163,184,0.07)" }}>

          {/* Background grid */}
          <div className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(rgba(56,189,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.03) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          />
          {/* Radial glow top-left */}
          <div className="pointer-events-none absolute -left-20 -top-20 h-[500px] w-[500px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(56,189,248,0.06) 0%, transparent 70%)" }} />
          {/* Radial glow bottom-right */}
          <div className="pointer-events-none absolute -bottom-20 -right-20 h-[400px] w-[400px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(167,139,250,0.04) 0%, transparent 70%)" }} />

          <div className="relative flex h-full w-full flex-col px-10 py-10 xl:px-14 xl:py-12">
            {/* Logo */}
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)" }}>
                <BeeLogo className="h-4 w-4" />
              </span>
              <span className="text-[15px] font-bold tracking-tight" style={{ color: "rgba(255,255,255,0.90)" }}>
                Vectorbee
              </span>
            </Link>

            <div className="my-auto max-w-lg space-y-9">
              {/* Eyebrow */}
              <span className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.2em]"
                style={{ color: "rgba(56,189,248,0.75)" }}>
                Production control plane for AI agent jobs
              </span>

              {/* Headline */}
              <div className="space-y-4">
                <h1 className="text-balance text-[2.25rem] font-bold leading-[1.1] tracking-[-0.03em]"
                  style={{ color: "rgba(241,245,249,0.97)" }}>
                  {mode === "signin"
                    ? "Operate AI agents with confidence."
                    : "Run AI agent jobs safely."}
                </h1>
                <p className="text-[15px] leading-7" style={{ color: "rgba(148,163,184,0.75)" }}>
                  {mode === "signin"
                    ? "Schedule, inspect, retry, and approve long-running AI agent workflows — with complete execution traceability."
                    : "Create your workspace and ship AI agent automations with approval gates, retries, cost budgets, and audit logs."}
                </p>
              </div>

              {/* Benefit list */}
              <ul className="space-y-2.5">
                {BENEFITS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "rgba(56,189,248,0.12)" }}>
                      <Check className="h-2.5 w-2.5" style={{ color: "#38BDF8" }} />
                    </span>
                    <span className="text-[13px] leading-6" style={{ color: "rgba(148,163,184,0.70)" }}>{item}</span>
                  </li>
                ))}
              </ul>

              {/* Run timeline preview */}
              <div className="rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", backdropFilter: "blur(8px)" }}>
                {/* Mini chrome */}
                <div className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-widest"
                    style={{ color: "rgba(148,163,184,0.35)" }}>
                    Customer Renewal Intelligence · Run #47
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                    style={{ borderColor: "rgba(52,211,153,0.25)", background: "rgba(52,211,153,0.08)", color: "#34D399" }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    SUCCEEDED
                  </span>
                </div>
                {/* Events */}
                <div className="space-y-0 px-4 py-3">
                  {PREVIEW_EVENTS.map((e, i) => (
                    <div key={e.type} className="flex items-start gap-2.5" style={{ paddingTop: i > 0 ? 6 : 0 }}>
                      <div className="flex flex-col items-center pt-0.5">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", e.dot)} />
                        {i < PREVIEW_EVENTS.length - 1 && (
                          <div className="mt-1 w-px flex-1" style={{ height: 10, background: "rgba(255,255,255,0.07)" }} />
                        )}
                      </div>
                      <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
                        <span className="text-[11px] leading-4 truncate" style={{ color: "rgba(203,213,225,0.55)" }}>
                          {e.label}
                        </span>
                        <span className="shrink-0 font-mono text-[9px] tabular-nums" style={{ color: "rgba(148,163,184,0.30)" }}>
                          {e.time}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats strip */}
              <div className="grid grid-cols-4 gap-0 rounded-xl overflow-hidden"
                style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                {[
                  { icon: Zap,       label: "12,480 tokens" },
                  { icon: Clock,     label: "2m 38s" },
                  { icon: Shield,    label: "1 approval" },
                  { icon: GitBranch, label: "5 agents" },
                ].map(({ icon: Icon, label }, i) => (
                  <div key={label} className="flex flex-col items-center gap-1 py-3"
                    style={{ borderRight: i < 3 ? "1px solid rgba(255,255,255,0.06)" : undefined, background: "rgba(255,255,255,0.02)" }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: "rgba(148,163,184,0.35)" }} />
                    <span className="text-[10px] text-center leading-tight" style={{ color: "rgba(148,163,184,0.40)" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer note */}
            <p className="text-[11px]" style={{ color: "rgba(100,116,139,0.60)" }}>
              Works with LangChain, CrewAI, AutoGen, and any HTTP-callable agent.
            </p>
          </div>
        </section>

        {/* ── Right — auth form ─────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 sm:px-10">
          <div className="w-full max-w-[380px] space-y-6">

            {/* Mobile header + theme toggle */}
            <div className="flex items-center justify-between lg:justify-end">
              <Link href="/" className="inline-flex items-center gap-2 lg:hidden">
                <BeeLogo className="h-6 w-6" />
                <span className="text-[14px] font-bold text-foreground">Vectorbee</span>
              </Link>
              <ThemeToggle />
            </div>

            {/* Heading */}
            <div className="space-y-1">
              <h2 className="text-[1.5rem] font-bold tracking-tight text-foreground">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {mode === "signin"
                  ? "Sign in to your Vectorbee workspace."
                  : "Start running AI agent workflows reliably."}
              </p>
            </div>

            {/* Error banner */}
            {error && (
              <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-[13px] font-medium text-red-400">
                {error}
              </div>
            )}

            {/* Form card */}
            <div className="rounded-2xl border border-border bg-card p-7 shadow-sm">

              {/* SSO section */}
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Work email
                  </span>
                  <Input
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    placeholder="name@company.com"
                    disabled={disabled}
                    className="h-10 text-[13px] placeholder:text-muted-foreground/35"
                    onKeyDown={(e) => e.key === "Enter" && void startSso()}
                  />
                </label>

                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void startSso()}
                  className="h-10 w-full justify-between rounded-xl text-[13px] font-medium"
                >
                  <span className="inline-flex items-center gap-2">
                    <EnterpriseSsoMark className="h-4 w-4 text-muted-foreground" />
                    Continue with SSO
                  </span>
                  {loading === "sso"
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </div>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] text-muted-foreground">or continue with</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              {/* OAuth providers */}
              <div className="space-y-2">
                <ProviderButton
                  icon={<GitHubMark className="h-[18px] w-[18px]" />}
                  label="GitHub"
                  loading={loading === "github"}
                  disabled={disabled}
                  onClick={() => void startOAuth("github")}
                />
                <ProviderButton
                  icon={<GoogleMark className="h-[18px] w-[18px]" />}
                  label="Google"
                  loading={loading === "google"}
                  disabled={disabled}
                  onClick={() => void startOAuth("google")}
                />
                <ProviderButton
                  icon={<MicrosoftMark className="h-[18px] w-[18px]" />}
                  label="Microsoft"
                  loading={loading === "azure"}
                  disabled={disabled}
                  onClick={() => void startOAuth("azure")}
                />
              </div>
            </div>

            {/* Switch mode */}
            <div className="flex items-center justify-between px-1 text-[13px] text-muted-foreground">
              <p>
                {mode === "signin" ? "No account?" : "Already have an account?"}
                {" "}
                <Link href={alternateHref}
                  className="font-semibold text-foreground underline-offset-4 hover:underline">
                  {alternateLabel}
                </Link>
              </p>
              <Link href={"/docs/security" as never} target="_blank" rel="noopener noreferrer"
                className="text-[12px] transition-colors hover:text-foreground">
                Privacy
              </Link>
            </div>

            {/* Back to home */}
            <div className="text-center">
              <Link href="/"
                className="inline-flex items-center gap-1 text-[12px] text-muted-foreground/50 transition-colors hover:text-muted-foreground">
                ← Back to homepage
              </Link>
            </div>
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
        "group flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3.5 text-[13px] font-medium text-foreground",
        "transition-all hover:border-border/80 hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      <span className="inline-flex items-center gap-2.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : icon}
        Continue with {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
