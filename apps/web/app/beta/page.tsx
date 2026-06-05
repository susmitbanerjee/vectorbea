"use client";

import { useState, useEffect } from "react";
import { CheckCircle2, Clock, Loader2, LogOut, XCircle } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { apiFetch, setAccessToken } from "@/lib/api/client";

function betaUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? "http://localhost:8080").trimEnd().replace(/\/$/, "");
  return base + path;
}

function ensureTokenFromCookie() {
  if (typeof document === "undefined") return;
  const match = document.cookie.match(/(?:^|;\s*)vb-token-transfer=([^;]+)/);
  if (match?.[1]) {
    setAccessToken(decodeURIComponent(match[1]));
    document.cookie = "vb-token-transfer=; max-age=0; path=/";
  }
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[12px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
      {children}{required && <span className="text-amber-500 ml-0.5">*</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 transition-all";
const textareaCls = inputCls + " resize-none leading-relaxed";

export default function BetaWaitlistPage() {
  const [submitted, setSubmitted]           = useState(false);
  const [alreadySubmitted, setAlreadySub]   = useState(false);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
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
    apiFetch<{ betaStatus: string }>(betaUrl("/api/beta/status"))
      .then(res => {
        if (res.betaStatus && res.betaStatus !== "waitlisted") {
          setExistingStatus(res.betaStatus);
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
      const res = await apiFetch<{ alreadySubmitted?: boolean; status?: string }>(
        betaUrl("/api/beta/apply"), { method: "POST", json: form }
      );
      if (res.alreadySubmitted) {
        setExistingStatus(res.status ?? "waitlisted");
        setAlreadySub(true);
      } else {
        setSubmitted(true);
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
    <div className="min-h-screen bg-[#FAFAF8] flex flex-col">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 h-[60px] flex items-center justify-between px-6 sm:px-10 bg-white/90 backdrop-blur border-b border-slate-200/70">
        <div className="flex items-center gap-2.5">
          <Image src="/icon.svg" alt="Vectorbea" width={28} height={28} className="rounded-[7px]" />
          <span className="text-[15px] font-bold tracking-tight text-slate-900">Vectorbea</span>
          <span className="hidden sm:inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-700 uppercase tracking-wider">
            Private Beta
          </span>
        </div>
        <button type="button" onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-700 transition-colors">
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
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
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
            <div className="space-y-8">

              {/* Hero text */}
              <div>
                <p className="text-[11.5px] font-bold uppercase tracking-widest text-amber-600 mb-3">
                  Invite-only private beta
                </p>
                <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight text-slate-900 leading-[1.15]">
                  Build durable<br className="hidden sm:block" /> agent workflows.
                </h1>
                <p className="mt-4 text-[15px] text-slate-500 leading-relaxed max-w-md">
                  Vectorbea is for backend and AI teams who need reliable, observable, and recoverable agent automation — not another prompt playground.
                </p>
              </div>

              {/* Form card */}
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">

                <div className="px-6 sm:px-8 pt-7 pb-2 border-b border-slate-100">
                  <h2 className="text-[16px] font-semibold text-slate-800">Tell us about yourself</h2>
                  <p className="text-[13px] text-slate-400 mt-0.5">We read every application personally.</p>
                </div>

                <form onSubmit={handleSubmit} className="px-6 sm:px-8 py-6 space-y-5">

                  {/* Name + Company */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label required>Full name</Label>
                      <input value={form.fullName} onChange={e => set("fullName", e.target.value)}
                        required placeholder="Alex Chen"
                        className={inputCls} />
                    </div>
                    <div>
                      <Label>Company</Label>
                      <input value={form.company} onChange={e => set("company", e.target.value)}
                        placeholder="Acme Corp"
                        className={inputCls} />
                    </div>
                  </div>

                  {/* Role */}
                  <div>
                    <Label>Your role</Label>
                    <input value={form.role} onChange={e => set("role", e.target.value)}
                      placeholder="Backend engineer, AI lead, CTO…"
                      className={inputCls} />
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-100 pt-1" />

                  {/* Use case */}
                  <div>
                    <Label required>What are you trying to automate?</Label>
                    <textarea required rows={4} value={form.useCase} onChange={e => set("useCase", e.target.value)}
                      placeholder="e.g. We run daily risk scoring workflows across 50k customers. Each workflow fetches data, runs through an AI model, triggers alerts, and updates our CRM — but retries and observability are brittle."
                      className={textareaCls} />
                  </div>

                  {/* Current tools */}
                  <div>
                    <Label>What tools do you use today?</Label>
                    <input value={form.currentTools} onChange={e => set("currentTools", e.target.value)}
                      placeholder="LangGraph, n8n, Temporal, Airflow, home-built scripts…"
                      className={inputCls} />
                  </div>

                  {/* Pain point */}
                  <div>
                    <Label>What breaks with your current setup?</Label>
                    <input value={form.painPoint} onChange={e => set("painPoint", e.target.value)}
                      placeholder="No visibility, silent failures, hard to retry partial workflows…"
                      className={inputCls} />
                  </div>

                  {/* Runs + Team */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Workflow runs / week</Label>
                      <input value={form.workflowsPerWeek} onChange={e => set("workflowsPerWeek", e.target.value)}
                        placeholder="50 – 500, 1000+…"
                        className={inputCls} />
                    </div>
                    <div>
                      <Label>Team size</Label>
                      <input value={form.teamSize} onChange={e => set("teamSize", e.target.value)}
                        placeholder="Solo, 2–5, 10+…"
                        className={inputCls} />
                    </div>
                  </div>

                  {/* BYOK */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="mt-0.5 shrink-0">
                      <input type="checkbox" checked={form.byokReady}
                        onChange={e => set("byokReady", e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-400 focus:ring-offset-0" />
                    </div>
                    <div>
                      <p className="text-[13.5px] font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                        I can bring my own LLM API key
                      </p>
                      <p className="text-[12px] text-slate-400 mt-0.5">
                        OpenAI, Anthropic, or another provider — required for real execution
                      </p>
                    </div>
                  </label>

                  {/* Submit */}
                  <button type="submit" disabled={loading}
                    className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-slate-900 py-3.5 text-[14.5px] font-semibold text-white hover:bg-slate-800 active:bg-black disabled:opacity-50 transition-colors mt-2">
                    {loading
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
                      : <>
                          <Image src="/icon.svg" alt="" width={18} height={18} className="rounded opacity-90" />
                          Request access
                        </>}
                  </button>

                </form>

                <div className="px-6 sm:px-8 py-4 bg-slate-50 border-t border-slate-100">
                  <p className="text-[12px] text-slate-400 text-center">
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
        <p className="text-[11.5px] font-bold uppercase tracking-widest text-green-600 mb-3">Application submitted</p>
        <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight text-slate-900 leading-[1.15]">
          We&apos;ve received<br className="hidden sm:block" /> your application.
        </h1>
        <p className="mt-4 text-[15px] text-slate-500 leading-relaxed max-w-md">
          Thank you for your interest in Vectorbea. Every application is reviewed by a human — we&apos;ll reach out personally.
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
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
                <div className="shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                  <span className="text-[11px] font-bold text-slate-500 tabular-nums">{n}</span>
                </div>
                <div className="pt-0.5">
                  <p className="text-[13.5px] font-semibold text-slate-800">{title}</p>
                  <p className="text-[12.5px] text-slate-500 mt-0.5 leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <p className="text-[12.5px] text-slate-400">
              Questions?{" "}
              <a href="mailto:susmit@vectorbea.com" className="text-slate-700 font-medium hover:underline">
                susmit@vectorbea.com
              </a>
            </p>
          </div>
        </div>
      </div>

      <button type="button" onClick={onSignOut}
        className="flex items-center gap-1.5 text-[12.5px] text-slate-400 hover:text-slate-600 transition-colors">
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
          isApproved ? "text-green-600" : isRejected ? "text-red-500" : "text-amber-600"
        }`}>
          {isApproved ? "Application approved" : isRejected ? "Application closed" : "Application under review"}
        </p>
        <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight text-slate-900 leading-[1.15]">
          {isApproved ? "You're approved." : isRejected ? "Not a fit right now." : "We're reviewing your application."}
        </h1>
        <p className="mt-4 text-[15px] text-slate-500 leading-relaxed max-w-md">
          {isApproved
            ? "Your account has full access. Sign in to start building durable agent workflows."
            : isRejected
            ? "Your application wasn't accepted at this time. This may change as we expand access — feel free to reach out."
            : "We already have your application on file. We review every request manually and will reach out when we're ready to bring you in."}
        </p>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-full ${
            isApproved ? "bg-green-100" : isRejected ? "bg-red-50" : "bg-amber-50"
          }`}>
            {isApproved
              ? <CheckCircle2 className="h-5 w-5 text-green-600" />
              : isRejected
              ? <XCircle className="h-5 w-5 text-red-400" />
              : <Clock className="h-5 w-5 text-amber-500" />}
          </div>
          <div>
            <p className="text-[14px] font-semibold text-slate-800">
              {isApproved ? "Access granted" : isRejected ? "Application closed" : "No action needed"}
            </p>
            <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
              {isApproved
                ? "Sign out and sign back in to access your workspace."
                : isRejected
                ? "We may revisit as our beta evolves. Reach out anytime."
                : "You'll receive an email when your application is reviewed. Submitting again won't change the timeline."}
            </p>
          </div>
        </div>
      </div>

      <p className="text-[12.5px] text-slate-400">
        Questions?{" "}
        <a href="mailto:susmit@vectorbea.com" className="text-slate-700 font-medium hover:underline">
          susmit@vectorbea.com
        </a>
        {" "}·{" "}
        <button type="button" onClick={onSignOut}
          className="text-slate-400 hover:text-slate-700 transition-colors">
          Sign out
        </button>
      </p>
    </div>
  );
}
