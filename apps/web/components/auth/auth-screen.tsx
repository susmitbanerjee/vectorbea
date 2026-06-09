"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2, ArrowRight } from "lucide-react";
import {
  GitHubMark,
  GoogleMark,
  MicrosoftMark,
} from "@/components/auth/oauth-provider-icons";
import { setAccessToken } from "@/lib/api/client";
import { LogoCube, Checkpoint, DurableRunPanel, RuntimeConsole } from "@/components/brand/signature";

type Mode = "signin" | "signup";

const BENEFITS = [
  "Every node checkpoints as it runs",
  "Resume from failure, never restart",
  "Approval gates before risky actions",
  "Token & cost visibility per run",
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

  const labelCls = "block text-[12.5px] font-medium text-[#4B5563]";
  const inputCls =
    "w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[14px] text-[#0B0D0F] placeholder:text-[#9CA3AF] outline-none transition-all disabled:opacity-50 hover:border-[#C9CED4] focus:border-[#9CCFBB] focus:ring-2 focus:ring-[#E6F4EF]";

  return (
    <div className="min-h-screen" style={{ background: "#F7F8F9", color: "#0B0D0F" }}>
      <div className="grid min-h-screen lg:grid-cols-[1.1fr_minmax(440px,520px)]">

        {/* ── Left brand panel ──────────────────────────────────────────── */}
        <section className="vb-canvas-dots relative hidden overflow-hidden lg:flex" style={{ borderRight: "1px solid #E0E3E6" }}>
          {/* soft green glow */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(60% 50% at 25% 20%, rgba(0,127,78,0.07), transparent 70%)" }}
          />
          <div className="relative flex h-full w-full flex-col px-12 py-12 xl:px-16">
            {/* Logo */}
            <Link href="/" className="inline-flex w-fit items-center gap-2.5">
              <LogoCube />
              <span className="text-[16px] font-semibold tracking-[-0.01em] text-[#0B0D0F]">Vectorbea</span>
            </Link>

            {/* Story */}
            <div className="my-auto max-w-[460px]">
              <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1" style={{ borderColor: "#9CCFBB", background: "#E6F4EF" }}>
                <Checkpoint size={9} />
                <span className="font-mono text-[11px] font-medium text-[#006B45]">Durable execution for AI agents</span>
              </span>

              <h1 className="mt-6 text-balance font-bold leading-[1.04] tracking-[-0.03em]" style={{ fontSize: "clamp(30px, 3.2vw, 42px)" }}>
                Agents that resume,<br />not restart.
              </h1>

              <ul className="mt-7 space-y-2.5">
                {BENEFITS.map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ background: "#E6F4EF" }}>
                      <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 10 10">
                        <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#007F4E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-[13.5px] text-[#4B5563]">{item}</span>
                  </li>
                ))}
              </ul>

              {/* Signature durable-run + console */}
              <div className="relative mt-9">
                <DurableRunPanel />
                <div className="mt-4 w-[300px] max-w-full">
                  <RuntimeConsole />
                </div>
              </div>
            </div>

            <p className="font-mono text-[11px] text-[#9CA3AF]">
              Works with LangChain, CrewAI, AutoGen, and any HTTP-callable agent.
            </p>
          </div>
        </section>

        {/* ── Right: auth form ──────────────────────────────────────────── */}
        <section className="flex min-h-screen flex-col items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-[400px] space-y-6">

            {/* Mobile logo */}
            <div className="flex items-center lg:hidden">
              <Link href="/" className="inline-flex items-center gap-2.5">
                <LogoCube size={26} />
                <span className="text-[15px] font-semibold text-[#0B0D0F]">Vectorbea</span>
              </Link>
            </div>

            {/* Heading */}
            <div className="space-y-2">
              <span className="inline-flex items-center gap-2">
                <Checkpoint size={9} />
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#007F4E]">
                  {isSignup ? "New workspace" : "Welcome back"}
                </span>
              </span>
              <h2 className="text-[27px] font-bold leading-[1.15] tracking-[-0.02em] text-[#0B0D0F]">
                {isSignup ? "Create your account" : "Sign in to Vectorbea"}
              </h2>
              <p className="text-[14px] leading-[1.6] text-[#6B7280]">
                {isSignup
                  ? "Start building durable, observable agent workflows."
                  : "Resume building, running, and debugging durable workflows."}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-[10px] px-4 py-3" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B91C1C", fontSize: 13, fontWeight: 500 }}>
                {error}
              </div>
            )}

            {/* Form */}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
              {/* Card */}
              <div className="space-y-4 rounded-[14px] border bg-white p-7" style={{ borderColor: "#E0E3E6", boxShadow: "0 12px 36px rgba(11,13,15,0.06)" }}>
                {isSignup && (
                  <div className="space-y-1.5">
                    <label className={labelCls}>Full name</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Smith"
                      disabled={loading}
                      className={inputCls}
                      style={{ height: 42 }}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className={labelCls}>Work email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                    disabled={loading}
                    className={inputCls}
                    style={{ height: 42 }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className={labelCls}>Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isSignup ? "At least 8 characters" : "Your password"}
                      required
                      disabled={loading}
                      minLength={isSignup ? 8 : 1}
                      className={`${inputCls} pr-10`}
                      style={{ height: 42 }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] transition-colors hover:text-[#4B5563]"
                      tabIndex={-1}
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-[8px] text-[14px] font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: "#0B0D0F" }}
                  onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#1c1f22"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#0B0D0F"; }}
                >
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {isSignup ? "Creating account…" : "Signing in…"}</>
                    : <>{isSignup ? "Create account" : "Sign in"} <ArrowRight className="h-4 w-4" /></>
                  }
                </button>

                {/* OAuth divider */}
                <div className="flex items-center gap-3 pt-1">
                  <span className="h-px flex-1" style={{ background: "#E0E3E6" }} />
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9CA3AF]">or continue with</span>
                  <span className="h-px flex-1" style={{ background: "#E0E3E6" }} />
                </div>

                {/* OAuth buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "GitHub",    href: "/api/auth/github",    icon: <GitHubMark    className="h-[18px] w-[18px]" /> },
                    { label: "Google",    href: "/api/auth/google",    icon: <GoogleMark    className="h-[18px] w-[18px]" /> },
                    { label: "Microsoft", href: "/api/auth/microsoft", icon: <MicrosoftMark className="h-[18px] w-[18px]" /> },
                  ].map(({ label, href, icon }) => (
                    <a
                      key={label}
                      href={href}
                      title={`Continue with ${label}`}
                      className="flex h-10 items-center justify-center rounded-[8px] border transition-colors"
                      style={{ background: "#FFFFFF", borderColor: "#E0E3E6" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#F3F4F5"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#C9CED4"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = "#FFFFFF"; (e.currentTarget as HTMLAnchorElement).style.borderColor = "#E0E3E6"; }}
                    >
                      {icon}
                    </a>
                  ))}
                </div>
              </div>

              {/* Switch mode */}
              <div className="flex items-center justify-between px-1">
                <p className="text-[13px] text-[#6B7280]">
                  {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
                  <Link
                    href={isSignup ? "/signin" : "/signup"}
                    className="font-semibold text-[#007F4E] underline-offset-4 hover:underline"
                  >
                    {isSignup ? "Sign in" : "Create account"}
                  </Link>
                </p>
                <Link href="/" className="text-[12px] text-[#9CA3AF] transition-colors hover:text-[#4B5563]">
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
