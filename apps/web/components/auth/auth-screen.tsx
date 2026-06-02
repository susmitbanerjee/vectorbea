"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { BeeLogo } from "@/components/brand/bee-logo";
import {
  GitHubMark,
  GoogleMark,
  MicrosoftMark,
} from "@/components/auth/oauth-provider-icons";
import { setAccessToken } from "@/lib/api/client";

type Mode = "signin" | "signup";

const BENEFITS = [
  "Durable execution timeline for every agent run",
  "Approval gates before high-risk agent actions",
  "Retry and failure recovery with full context",
  "Token and cost budget visibility per run",
  "Complete audit trail for every agent decision",
];

export function AuthScreen({ mode }: { mode: Mode; next?: string }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/signin";
      const body = isSignup
        ? { email, password, fullName: fullName.trim() || undefined }
        : { email, password };

      const res  = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json() as {
        error?: string;
        accessToken?: string;
        user?: { id: string; email: string };
      };

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      // Store token so API calls can send Authorization header to the Kotlin API
      if (data.accessToken) setAccessToken(data.accessToken);

      // Redirect to dashboard (cookie also set server-side for SSR auth)
      window.location.assign("/dashboard");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(circle at 20% 15%, rgba(217,119,6,0.07), transparent 32%), " +
          "radial-gradient(circle at 80% 85%, rgba(217,119,6,0.03), transparent 30%), " +
          "#F8FAFC",
      }}
    >
      <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">

        {/* ── Left panel ────────────────────────────────────────────────── */}
        <section
          className="relative hidden overflow-hidden lg:flex"
          style={{ borderRight: "1px solid #E2E8F0" }}
        >
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), " +
                "linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative flex h-full w-full flex-col px-10 py-10 xl:px-14 xl:py-12">
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "#FEF3C7", border: "1px solid #FDE68A" }}
              >
                <BeeLogo className="h-4 w-4 text-amber-700" />
              </span>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "#0F172A" }}>
                Vectorbea
              </span>
            </Link>

            <div className="my-auto max-w-lg space-y-9">
              <span
                className="inline-block font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
                style={{ color: "#D97706" }}
              >
                Production control plane for AI agent jobs
              </span>
              <div className="space-y-3">
                <h1
                  className="text-balance leading-[1.1] tracking-[-0.03em]"
                  style={{ fontSize: "2.1rem", fontWeight: 700, color: "#0F172A" }}
                >
                  {isSignup ? "Run AI agent jobs safely." : "Operate AI agents with confidence."}
                </h1>
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "#475569" }}>
                  {isSignup
                    ? "Create your workspace and ship AI agent automations with approval gates, retries, cost budgets, and audit logs."
                    : "Schedule, inspect, retry, and approve long-running AI agent workflows — with complete execution traceability."}
                </p>
              </div>
              <ul className="space-y-2.5">
                {BENEFITS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "#FEF3C7" }}
                    >
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 10 10">
                        <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#D97706" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p style={{ fontSize: 11, color: "#94A3B8" }}>
              Works with LangChain, CrewAI, AutoGen, and any HTTP-callable agent.
            </p>
          </div>
        </section>

        {/* ── Right: auth form ──────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[400px] space-y-6">

            {/* Mobile logo */}
            <div className="flex items-center lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ background: "#FEF3C7", border: "1px solid #FDE68A" }}
                >
                  <BeeLogo className="h-3.5 w-3.5 text-amber-700" />
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Vectorbea</span>
              </Link>
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <h2 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.025em", color: "#0F172A", lineHeight: 1.2 }}>
                {isSignup ? "Create your account" : "Sign in to Vectorbea"}
              </h2>
              <p style={{ fontSize: 14, color: "#64748B", lineHeight: 1.6 }}>
                {isSignup
                  ? "Start building reliable AI workflows."
                  : "Continue building, running, and debugging durable agentic workflows."}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", fontSize: 13, fontWeight: 500 }}
              >
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {/* Card */}
              <div
                className="rounded-2xl space-y-4"
                style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 18px 48px rgba(15,23,42,0.08)", padding: "28px" }}
              >
                {isSignup && (
                  <div className="space-y-1.5">
                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#475569" }}>
                      Full name
                    </label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Smith"
                      disabled={loading}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] text-slate-800 placeholder:text-slate-400 outline-none transition-all disabled:opacity-50 hover:border-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                      style={{ height: 42 }}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#475569" }}>
                    Work email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    disabled={loading}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] text-slate-800 placeholder:text-slate-400 outline-none transition-all disabled:opacity-50 hover:border-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                    style={{ height: 42 }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#475569" }}>
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignup ? "At least 8 characters" : "Your password"}
                      required
                      disabled={loading}
                      minLength={isSignup ? 8 : 1}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-[13.5px] text-slate-800 placeholder:text-slate-400 outline-none transition-all disabled:opacity-50 hover:border-slate-300 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
                      style={{ height: 42 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white transition-all disabled:opacity-50"
                  style={{ background: "#D97706", fontSize: 14, boxShadow: "0 2px 8px rgba(217,119,6,0.28)" }}
                  onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#B45309"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#D97706"; }}
                >
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {isSignup ? "Creating account…" : "Signing in…"}</>
                    : isSignup ? "Create account" : "Sign in"
                  }
                </button>

                {/* OAuth divider */}
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1" style={{ background: "#E2E8F0" }} />
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>or continue with</span>
                  <span className="h-px flex-1" style={{ background: "#E2E8F0" }} />
                </div>

                {/* OAuth buttons */}
                <div className="space-y-2">
                  {[
                    { label: "GitHub",    href: "/api/auth/github",    icon: <GitHubMark    className="h-[18px] w-[18px]" /> },
                    { label: "Google",    href: "/api/auth/google",    icon: <GoogleMark    className="h-[18px] w-[18px]" /> },
                    { label: "Microsoft", href: "/api/auth/microsoft", icon: <MicrosoftMark className="h-[18px] w-[18px]" /> },
                  ].map(({ label, href, icon }) => (
                    <a
                      key={label}
                      href={href}
                      className="flex h-10 w-full items-center justify-between rounded-xl border px-3.5 transition-all"
                      style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", fontSize: 13, fontWeight: 600, color: "#334155", textDecoration: "none" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#F8FAFC"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#CBD5E1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#FFFFFF"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#E2E8F0"; }}
                    >
                      <span className="inline-flex items-center gap-2.5">{icon} Continue with {label}</span>
                    </a>
                  ))}
                </div>
              </div>

              {/* Switch mode */}
              <div className="flex items-center justify-between px-1">
                <p style={{ fontSize: 13, color: "#64748B" }}>
                  {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                  <Link
                    href={isSignup ? "/signin" : "/signup"}
                    style={{ fontWeight: 600, color: "#D97706" }}
                    className="hover:underline underline-offset-4"
                  >
                    {isSignup ? "Sign in" : "Create account"}
                  </Link>
                </p>
                <Link
                  href="/"
                  style={{ fontSize: 12, color: "#94A3B8" }}
                  className="transition-colors hover:text-slate-600"
                >
                  ← Home
                </Link>
              </div>
            </form>
          </div>
        </section>

      </div>
    </div>
  );
}
