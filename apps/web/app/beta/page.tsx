"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Clock, Loader2, LogOut, XCircle } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { setAccessToken } from "@/lib/api/client";

function ensureTokenFromCookie() {
  if (typeof document === "undefined") return;
  const match = document.cookie.match(/(?:^|;\s*)vb-token-transfer=([^;]+)/);
  if (match?.[1]) {
    setAccessToken(decodeURIComponent(match[1]));
    document.cookie = "vb-token-transfer=; max-age=0; path=/";
  }
}

/**
 * Same-origin call to the beta proxy routes — authenticated by the httpOnly
 * session cookie, so it works even right after the email-verification click
 * (when no localStorage token copy exists yet).
 */
async function betaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

function Label({ children, required, hint }: { children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <label className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
        {children}{required && <span className="ml-0.5 text-[#DC2626]">*</span>}
      </label>
      {hint && <span className="text-[11px] text-[#B6BCC2]">{hint}</span>}
    </div>
  );
}

const inputCls = "w-full rounded-[9px] border border-[#E0E3E6] bg-white px-3.5 py-2.5 text-[14px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15 transition-all";
const textareaCls = inputCls + " resize-none leading-relaxed";

/** Single-select chip row — friendlier than free-text for ranges. */
function ChipSelect({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(active ? "" : opt)}
            className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              active
                ? "border-[#007F4E] bg-[#E6F4EF] text-[#006B45]"
                : "border-[#E0E3E6] bg-white text-[#4B5563] hover:border-[#C9CED4] hover:bg-[#FAFBFB]"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function BetaWaitlistPage() {
  const [submitted, setSubmitted]           = useState(false);
  const [alreadySubmitted, setAlreadySub]   = useState(false);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [justVerified, setJustVerified]     = useState(false);
  const [form, setForm] = useState({
    fullName: "", company: "", role: "", useCase: "",
    currentTools: "", painPoint: "", workflowsPerWeek: "", teamSize: "",
    byokReady: false,
  });

  function set(key: string, value: string | boolean) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    ensureTokenFromCookie();
    // Arrived from the email-verification link?
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("verified") === "1") {
      setJustVerified(true);
    }
    betaFetch<{ betaStatus: string; applicationStatus?: string | null; alreadySubmitted?: boolean }>("/api/beta/status")
      .then(res => {
        if (res.betaStatus === "approved") {
          window.location.assign("/dashboard");
          return;
        }
        if (res.alreadySubmitted || (res.betaStatus && res.betaStatus !== "waitlisted")) {
          setExistingStatus(res.applicationStatus ?? res.betaStatus);
          setAlreadySub(true);
        }
      })
      .catch(() => {})
      .finally(() => setCheckingStatus(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim() || !form.useCase.trim()) {
      toast.error("Please fill in your name and use case.");
      return;
    }
    setLoading(true);
    ensureTokenFromCookie();
    try {
      const res = await betaFetch<{ alreadySubmitted?: boolean; status?: string }>(
        "/api/beta/apply",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) },
      );
      if (res.alreadySubmitted) {
        setExistingStatus(res.status ?? "waitlisted");
        setAlreadySub(true);
      } else {
        setSubmitted(true);
        // No client-side telemetry here — the Kotlin API emits the canonical
        // beta_application_submitted with full structured properties.
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try { await fetch("/api/auth/signout", { method: "POST" }); } catch {}
    window.location.href = "/signin";
  }

  return (
    <div className="min-h-screen bg-[#F7F8F9] flex flex-col">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 h-[60px] flex items-center justify-between px-6 sm:px-10 bg-white/90 backdrop-blur border-b border-[#E0E3E6]">
        <div className="flex items-center gap-2.5">
          <Image src="/icon.svg" alt="Vectorbea" width={28} height={28} className="rounded-[7px]" />
          <span className="text-[15px] font-bold tracking-tight text-[#0B0D0F]">Vectorbea</span>
          <span className="hidden sm:inline-flex items-center rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#006B45]">
            Private Beta
          </span>
        </div>
        <button type="button" onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-[#9CA3AF] hover:text-[#0B0D0F] transition-colors">
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-start justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="w-full max-w-[560px]">

          {/* Loading */}
          {checkingStatus && (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-[#C9CED4]" />
            </div>
          )}

          {/* Already submitted / status state */}
          {!checkingStatus && alreadySubmitted && (
            <StatusScreen status={existingStatus} onSignOut={handleSignOut} />
          )}

          {/* Submitted success */}
          {!checkingStatus && !alreadySubmitted && submitted && (
            <SuccessScreen onSignOut={handleSignOut} />
          )}

          {/* Application form */}
          {!checkingStatus && !alreadySubmitted && !submitted && (
            <div className="space-y-7">

              {/* Email-verified banner (arrival from the verification link) */}
              {justVerified && (
                <div className="flex items-center gap-2.5 rounded-[10px] border border-[#9CCFBB] bg-[#E6F4EF]/70 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#007F4E]" />
                  <p className="text-[13px] font-medium text-[#006B45]">
                    Email verified — one last step: tell us what you&apos;re building.
                  </p>
                </div>
              )}

              {/* Hero text */}
              <div>
                <p className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#007F4E]">
                  Invite-only private beta
                </p>
                <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight text-[#0B0D0F] leading-[1.15]">
                  Agents that resume,<br className="hidden sm:block" /> not restart.
                </h1>
                <p className="mt-4 text-[15px] text-[#6B7280] leading-relaxed max-w-md">
                  Vectorbea is for teams running real, long-lived AI automation — workflows that survive failures,
                  pause for approvals, and resume from checkpoints. Tell us what you&apos;re trying to solve.
                </p>
              </div>

              {/* Form card */}
              <div className="overflow-hidden rounded-[14px] border border-[#E0E3E6] bg-white shadow-[0_12px_36px_rgba(11,13,15,0.05)]">

                <div className="border-b border-[#F1F2F4] px-6 pt-6 pb-4 sm:px-8">
                  <h2 className="text-[16px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Your use case</h2>
                  <p className="mt-0.5 text-[13px] text-[#9CA3AF]">We read every application personally — the more specific, the faster the review.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6 sm:px-8">

                  {/* Name + Company */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label required>Full name</Label>
                      <input value={form.fullName} onChange={e => set("fullName", e.target.value)}
                        required placeholder="Alex Chen"
                        className={inputCls} />
                    </div>
                    <div>
                      <Label hint="optional">Company</Label>
                      <input value={form.company} onChange={e => set("company", e.target.value)}
                        placeholder="Acme Corp"
                        className={inputCls} />
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <Label hint="optional">Your role</Label>
                    <input value={form.role} onChange={e => set("role", e.target.value)}
                      placeholder="Backend engineer, AI lead, CTO…"
                      className={inputCls} />
                  </div>

                  {/* Divider */}
                  <div className="border-t border-[#F1F2F4] pt-1" />

                  {/* Use case — the core question */}
                  <div>
                    <Label required>What are you trying to solve with Vectorbea?</Label>
                    <textarea required rows={5} value={form.useCase} onChange={e => set("useCase", e.target.value)}
                      placeholder={"Describe the workflow you want to automate and where it hurts today.\n\ne.g. \"Nightly we score 50k accounts for churn risk: pull from Postgres, run an LLM per account, alert the owner, update the CRM. When step 3 of 5 fails we restart from zero and re-pay every token — and risky writes need a human sign-off we can't model.\""}
                      className={textareaCls} />
                    <p className="mt-1.5 text-[11.5px] leading-[1.5] text-[#9CA3AF]">
                      Useful details: what triggers it, the steps involved, where humans need to approve, and what failure costs you.
                    </p>
                  </div>

                  {/* Current tools */}
                  <div>
                    <Label hint="optional">What do you use today?</Label>
                    <input value={form.currentTools} onChange={e => set("currentTools", e.target.value)}
                      placeholder="LangGraph, n8n, Temporal, Airflow, home-built scripts…"
                      className={inputCls} />
                  </div>

                  {/* Pain point */}
                  <div>
                    <Label hint="optional">What breaks with that setup?</Label>
                    <input value={form.painPoint} onChange={e => set("painPoint", e.target.value)}
                      placeholder="No visibility, silent failures, lost work on retries, no human-in-the-loop…"
                      className={inputCls} />
                  </div>

                  {/* Runs + Team — quick chips instead of free text */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label hint="optional">Workflow runs / week</Label>
                      <ChipSelect
                        options={["< 50", "50 – 500", "500 – 5k", "5k+"]}
                        value={form.workflowsPerWeek}
                        onChange={v => set("workflowsPerWeek", v)}
                      />
                    </div>
                    <div>
                      <Label hint="optional">Team size</Label>
                      <ChipSelect
                        options={["Solo", "2 – 5", "6 – 20", "20+"]}
                        value={form.teamSize}
                        onChange={v => set("teamSize", v)}
                      />
                    </div>
                  </div>

                  {/* BYOK */}
                  <label className="group flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-[#FAFBFB] p-3.5 transition-colors hover:border-[#C9CED4]">
                    <input type="checkbox" checked={form.byokReady}
                      onChange={e => set("byokReady", e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#007F4E]" />
                    <div>
                      <p className="text-[13.5px] font-medium text-[#0B0D0F]">
                        I can bring my own LLM API key
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#9CA3AF]">
                        OpenAI, Anthropic, or another provider — required for real execution
                      </p>
                    </div>
                  </label>

                  {/* Submit */}
                  <button type="submit" disabled={loading}
                    className="mt-2 flex w-full items-center justify-center gap-2.5 rounded-[10px] bg-[#0B0D0F] py-3.5 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#23272B] disabled:opacity-50">
                    {loading
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                      : <>Request access <span aria-hidden>→</span></>}
                  </button>

                </form>

                <div className="border-t border-[#F1F2F4] bg-[#FAFBFB] px-6 py-4 sm:px-8">
                  <p className="text-center text-[12px] text-[#9CA3AF]">
                    We review every application personally. No spam, no public free tier, no sales calls.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Success screen ────────────────────────────────────────────────────────── */
function SuccessScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="space-y-8">
      <div>
        <p className="text-[11.5px] font-bold uppercase tracking-widest text-[#007F4E] mb-3">Application submitted</p>
        <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight text-[#0B0D0F] leading-[1.15]">
          We&apos;ve received<br className="hidden sm:block" /> your application.
        </h1>
        <p className="mt-4 text-[15px] text-[#6B7280] leading-relaxed max-w-md">
          Thank you for your interest in Vectorbea. Every application is reviewed by a human — we&apos;ll reach out personally.
        </p>
      </div>

      <div className="rounded-[14px] bg-white border border-[#E0E3E6] shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8 space-y-5">

          {/* Steps */}
          <div className="space-y-4">
            {[
              {
                n: "01",
                title: "We review your use case",
                body: "Our team reads every application. We look for teams with real automation needs who would benefit most from Vectorbea.",
              },
              {
                n: "02",
                title: "We reach out personally",
                body: "If your use case is a good fit, you'll hear from us directly within a few business days.",
              },
              {
                n: "03",
                title: "You get full workspace access",
                body: "Approved teams start in simulation mode — no real systems touched until you're ready.",
              },
            ].map(({ n, title, body }) => (
              <div key={n} className="flex gap-4">
                <div className="shrink-0 w-8 h-8 rounded-full bg-[#F3F4F5] flex items-center justify-center">
                  <span className="text-[11px] font-bold text-[#6B7280] tabular-nums">{n}</span>
                </div>
                <div className="pt-0.5">
                  <p className="text-[13.5px] font-semibold text-[#0B0D0F]">{title}</p>
                  <p className="text-[12.5px] text-[#6B7280] mt-0.5 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-[#F1F2F4] pt-4">
            <p className="text-[12.5px] text-[#9CA3AF]">
              Questions? Reach out and we&apos;ll get back to you.
            </p>
          </div>
        </div>
      </div>

      <button type="button" onClick={onSignOut}
        className="flex items-center gap-1.5 text-[12.5px] text-[#9CA3AF] hover:text-[#4B5563] transition-colors">
        <LogOut className="h-3.5 w-3.5" /> Sign out
      </button>
    </div>
  );
}

/* ── Status screen (already submitted / approved / rejected) ───────────────── */
function StatusScreen({ status, onSignOut }: { status: string | null; onSignOut: () => void }) {
  const isApproved = status === "approved";
  const isRejected = status === "rejected";
  const isWaiting  = !isApproved && !isRejected;

  return (
    <div className="space-y-8">
      <div>
        <p className={`text-[11.5px] font-bold uppercase tracking-widest mb-3 ${
          isApproved ? "text-[#007F4E]" : isRejected ? "text-red-500" : "text-amber-600"
        }`}>
          {isApproved ? "Application approved" : isRejected ? "Application closed" : "Application under review"}
        </p>
        <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight text-[#0B0D0F] leading-[1.15]">
          {isApproved ? "You're approved." : isRejected ? "Not a fit right now." : "We're reviewing your application."}
        </h1>
        <p className="mt-4 text-[15px] text-[#6B7280] leading-relaxed max-w-md">
          {isApproved
            ? "Your account has full access. Sign in to start building durable agent workflows."
            : isRejected
            ? "Your application wasn't accepted at this time. This may change as we expand access — feel free to reach out."
            : "We already have your application on file. We review every request manually and will reach out when we're ready to bring you in."}
        </p>
      </div>

      <div className="rounded-[14px] bg-white border border-[#E0E3E6] shadow-sm p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full ${
            isApproved ? "bg-[#E6F4EF]" : isRejected ? "bg-red-50" : "bg-amber-50"
          }`}>
            {isApproved
              ? <CheckCircle2 className="h-5 w-5 text-[#007F4E]" />
              : isRejected
              ? <XCircle className="h-5 w-5 text-red-400" />
              : <Clock className="h-5 w-5 text-amber-500" />}
          </div>
          <div>
            <p className="text-[14px] font-semibold text-[#0B0D0F]">
              {isApproved ? "Access granted" : isRejected ? "Application closed" : "No action needed"}
            </p>
            <p className="text-[13px] text-[#6B7280] mt-1 leading-relaxed">
              {isApproved
                ? "Sign out and sign back in to access your workspace."
                : isRejected
                ? "We may revisit as our beta evolves. Reach out anytime."
                : "You'll receive an email when your application is reviewed. Submitting again won't change the timeline."}
            </p>
          </div>
        </div>
      </div>

      <p className="text-[12.5px] text-[#9CA3AF]">
        Questions? Reach out and we&apos;ll get back to you.
        {" "}·{" "}
        <button type="button" onClick={onSignOut}
          className="text-[#9CA3AF] hover:text-[#374151] transition-colors">
          Sign out
        </button>
      </p>
    </div>
  );
}
