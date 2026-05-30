"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, ChevronRight, Clock, GitBranch, Loader2, Shield, Zap } from "lucide-react";

import { BeeLogo } from "@/components/brand/bee-logo";
import {
  EnterpriseSsoMark,
  GitHubMark,
  GoogleMark,
  MicrosoftMark,
} from "@/components/auth/oauth-provider-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Mode = "signin" | "signup";
type Provider = "github" | "google" | "azure" | "sso";

// ─── Left panel data ──────────────────────────────────────────────────────────

const PREVIEW_EVENTS = [
  { type: "RUN_STARTED",         label: "Run started",                       dot: "bg-blue-500",    time: "09:00:01" },
  { type: "AGENT_STARTED",       label: "Orchestrator Agent started",        dot: "bg-violet-500",  time: "09:00:02" },
  { type: "HTTP_CALL_COMPLETED", label: "Usage API returned 128 customers",  dot: "bg-teal-500",    time: "09:00:41" },
  { type: "LLM_CALL_COMPLETED",  label: "Risk model · 6,200 tokens",        dot: "bg-purple-500",  time: "09:01:17" },
  { type: "APPROVAL_REQUESTED",  label: "Approval gate · CRM update",       dot: "bg-amber-500",   time: "09:01:40" },
  { type: "APPROVAL_APPROVED",   label: "Approved by Demo Owner",            dot: "bg-emerald-500", time: "09:03:18" },
  { type: "ARTIFACT_CREATED",    label: "risk_report.json generated",       dot: "bg-indigo-500",  time: "09:04:02" },
  { type: "RUN_SUCCEEDED",       label: "Run succeeded · $0.061 · 2m 38s",  dot: "bg-emerald-500", time: "09:04:08" },
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
    <div
      className="min-h-screen"
      style={{
        background: "radial-gradient(circle at 20% 15%, rgba(37,99,235,0.07), transparent 32%), radial-gradient(circle at 80% 85%, rgba(124,58,237,0.05), transparent 30%), #F8FAFC",
      }}
    >
      <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">

        {/* ── Left — light feature panel ────────────────────────────────── */}
        <section
          className="relative hidden overflow-hidden lg:flex"
          style={{ borderRight: "1px solid #E2E8F0" }}
        >
          {/* Subtle grid overlay */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div className="relative flex h-full w-full flex-col px-10 py-10 xl:px-14 xl:py-12">
            {/* Logo */}
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
              >
                <BeeLogo className="h-4 w-4 text-blue-600" />
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "#0F172A" }}>
                Vectorbea
              </span>
            </Link>

            <div className="my-auto max-w-lg space-y-9">
              {/* Eyebrow */}
              <span
                className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "#2563EB" }}
              >
                Production control plane for AI agent jobs
              </span>

              {/* Headline */}
              <div className="space-y-3">
                <h1
                  className="text-balance leading-[1.1] tracking-[-0.03em]"
                  style={{ fontSize: "2.1rem", fontWeight: 700, color: "#0F172A" }}
                >
                  {mode === "signin"
                    ? "Operate AI agents with confidence."
                    : "Run AI agent jobs safely."}
                </h1>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "#475569" }}>
                  {mode === "signin"
                    ? "Schedule, inspect, retry, and approve long-running AI agent workflows — with complete execution traceability."
                    : "Create your workspace and ship AI agent automations with approval gates, retries, cost budgets, and audit logs."}
                </p>
              </div>

              {/* Benefit list */}
              <ul className="space-y-2.5">
                {BENEFITS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "#DBEAFE" }}
                    >
                      <Check className="h-2.5 w-2.5" style={{ color: "#2563EB" }} />
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{item}</span>
                  </li>
                ))}
              </ul>

              {/* Run timeline preview card */}
              <div
                className="overflow-hidden rounded-2xl"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  boxShadow: "0 8px 24px rgba(15,23,42,0.07)",
                }}
              >
                {/* Mini chrome header */}
                <div
                  className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderBottom: "1px solid #F1F5F9", background: "#FAFBFC" }}
                >
                  <span
                    className="font-mono text-[9px] font-semibold uppercase tracking-widest"
                    style={{ color: "#94A3B8" }}
                  >
                    Customer Renewal Intelligence · Run #47
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                    style={{ borderColor: "#BBF7D0", background: "#ECFDF5", color: "#16A34A" }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    SUCCEEDED
                  </span>
                </div>
                {/* Event rows */}
                <div className="space-y-0 px-4 py-3">
                  {PREVIEW_EVENTS.map((e, i) => (
                    <div key={e.type} className="flex items-start gap-2.5" style={{ paddingTop: i > 0 ? 6 : 0 }}>
                      <div className="flex flex-col items-center pt-0.5">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", e.dot)} />
                        {i < PREVIEW_EVENTS.length - 1 && (
                          <div className="mt-1 w-px" style={{ height: 10, background: "#E2E8F0" }} />
                        )}
                      </div>
                      <div className="flex flex-1 items-start justify-between gap-2 min-w-0">
                        <span className="truncate" style={{ fontSize: 11, lineHeight: "16px", color: "#64748B" }}>
                          {e.label}
                        </span>
                        <span className="shrink-0 font-mono tabular-nums" style={{ fontSize: 9, color: "#94A3B8" }}>
                          {e.time}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Stats strip */}
              <div
                className="grid grid-cols-4 overflow-hidden rounded-2xl"
                style={{ border: "1px solid #E2E8F0", background: "#FFFFFF" }}
              >
                {[
                  { icon: Zap,       label: "12,480 tokens" },
                  { icon: Clock,     label: "2m 38s" },
                  { icon: Shield,    label: "1 approval" },
                  { icon: GitBranch, label: "5 agents" },
                ].map(({ icon: Icon, label }, i) => (
                  <div
                    key={label}
                    className="flex flex-col items-center gap-1 py-3"
                    style={{ borderRight: i < 3 ? "1px solid #F1F5F9" : undefined }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color: "#94A3B8" }} />
                    <span className="text-center" style={{ fontSize: 10, lineHeight: 1.3, color: "#64748B" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer note */}
            <p style={{ fontSize: 11, color: "#94A3B8" }}>
              Works with LangChain, CrewAI, AutoGen, and any HTTP-callable agent.
            </p>
          </div>
        </section>

        {/* ── Right — auth form ─────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-col items-center justify-center bg-transparent px-6 py-12 sm:px-10">
          <div className="w-full max-w-[400px] space-y-6">

            {/* Mobile logo */}
            <div className="flex items-center justify-between lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
                >
                  <BeeLogo className="h-3.5 w-3.5 text-blue-600" />
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Vectorbea</span>
              </Link>
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.025em", color: "#0F172A", lineHeight: 1.2 }}>
                {mode === "signin" ? "Sign in to Vectorbea" : "Create your Vectorbea workspace"}
              </h2>
              <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.6 }}>
                {mode === "signin"
                  ? "Continue building, running, and debugging durable agentic workflows."
                  : "Start building reliable AI workflows with approvals, retries, event history, and clear execution visibility."}
              </p>
            </div>

            {/* Error banner */}
            {error && (
              <div
                className="rounded-xl px-4 py-3"
                style={{
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#B91C1C",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {error}
              </div>
            )}

            {/* Form card */}
            <div
              className="rounded-2xl"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                boxShadow: "0 18px 48px rgba(15,23,42,0.08)",
                padding: "28px",
              }}
            >
              {/* SSO section */}
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span
                    className="block"
                    style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#475569" }}
                  >
                    Work email
                  </span>
                  <input
                    type="email"
                    value={workEmail}
                    onChange={(e) => setWorkEmail(e.target.value)}
                    placeholder="name@company.com"
                    disabled={disabled}
                    onKeyDown={(e) => e.key === "Enter" && void startSso()}
                    className="w-full rounded-xl px-3 transition-all disabled:opacity-50"
                    style={{
                      height: 42,
                      background: "#FFFFFF",
                      border: "1px solid #CBD5E1",
                      fontSize: 13,
                      color: "#0F172A",
                      outline: "none",
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = "#2563EB";
                      e.target.style.boxShadow = "0 0 0 4px #DBEAFE";
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = "#CBD5E1";
                      e.target.style.boxShadow = "none";
                    }}
                  />
                </label>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void startSso()}
                  className="flex h-10 w-full items-center justify-between rounded-xl px-3.5 transition-all disabled:opacity-50"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#334155",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#F8FAFC"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FFFFFF"; }}
                >
                  <span className="inline-flex items-center gap-2">
                    <EnterpriseSsoMark className="h-4 w-4 text-slate-500" />
                    Continue with SSO
                  </span>
                  {loading === "sso"
                    ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#64748B" }} />
                    : <ArrowRight className="h-4 w-4" style={{ color: "#94A3B8" }} />}
                </button>
              </div>

              {/* Divider */}
              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1" style={{ background: "#E2E8F0" }} />
                <span style={{ fontSize: 11, color: "#94A3B8" }}>or continue with</span>
                <span className="h-px flex-1" style={{ background: "#E2E8F0" }} />
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
            <div className="flex items-center justify-between px-1">
              <p style={{ fontSize: 13, color: "#64748B" }}>
                {mode === "signin" ? "Don't have an account?" : "Already have an account?"}
                {" "}
                <Link
                  href={alternateHref}
                  style={{ fontWeight: 600, color: "#2563EB" }}
                  className="hover:underline underline-offset-4"
                >
                  {alternateLabel}
                </Link>
              </p>
              <Link
                href={"/docs/security" as never}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: "#94A3B8" }}
                className="transition-colors hover:text-slate-600"
              >
                Privacy
              </Link>
            </div>

            {/* Back to home */}
            <div className="text-center">
              <Link
                href="/"
                style={{ fontSize: 12, color: "#94A3B8" }}
                className="inline-flex items-center gap-1 transition-colors hover:text-slate-600"
              >
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
      className="group flex h-10 w-full items-center justify-between rounded-xl px-3.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        fontSize: 13,
        fontWeight: 600,
        color: "#334155",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#F8FAFC";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#CBD5E1";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#FFFFFF";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0";
      }}
    >
      <span className="inline-flex items-center gap-2.5">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#64748B" }} /> : icon}
        Continue with {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" style={{ color: "#CBD5E1" }} />
    </button>
  );
}
